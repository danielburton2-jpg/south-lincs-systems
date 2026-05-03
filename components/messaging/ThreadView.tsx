'use client'
/**
 * ThreadView
 *
 * Shows messages in a thread + the send box. Used on both
 * /dashboard/messages/[id] and /employee/messages/[id]. The page owns
 * the back navigation; this component just renders.
 *
 * Behaviour:
 *   • Auto-loads messages + thread metadata on mount
 *   • Auto-scrolls to bottom on first load
 *   • Realtime subscribes to new messages in this thread
 *   • Auto-marks thread as read after view (debounced)
 *   • Auto-scrolls to bottom on new message ONLY if user is already
 *     near the bottom (don't yank them up if they're scrolled to read history)
 *   • Renders attachments inline (image thumbs / PDF cards) with
 *     a fullscreen image lightbox on tap
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import MessageComposer from './MessageComposer'

type Attachment = {
  id: string
  message_id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number | null
  is_image: boolean
  signed_url: string | null
}

type Message = {
  id: string
  thread_id: string
  sender_id: string
  body: string | null
  created_at: string
  edited_at: string | null
  sender: { id: string; full_name: string; job_title: string | null } | null
  attachments: Attachment[]
}

type Thread = {
  id: string
  target_kind: string
  target_job_title: string | null
  title: string | null
}

type Member = {
  id: string
  full_name: string
  job_title: string | null
  role: string
}

const supabase = createClient()

type Props = {
  threadId: string
  /** The current user's id. Drives left/right alignment + read marker. */
  currentUserId: string
  /** Where to navigate when back is tapped. */
  onBack: () => void
  /** Optional accent for buttons. */
  accent?: 'slate' | 'indigo'
}

export default function ThreadView({ threadId, currentUserId, onBack, accent = 'slate' }: Props) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [showMembers, setShowMembers] = useState(false)
  const [error, setError] = useState('')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const messageIdSetRef = useRef<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)

  const accentBg = accent === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'
  const ownBubble = accent === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-white'

  // ── Initial load ──
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/threads/${threadId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not load thread')
        return
      }
      setThread(data.thread)
      setMembers(data.members || [])
      setMessages(data.messages || [])
      const ids = new Set<string>((data.messages || []).map((m: Message) => m.id))
      messageIdSetRef.current = ids
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    load()
  }, [load])

  // ── Auto-scroll to bottom on first load ──
  useEffect(() => {
    if (!loading && messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      isAtBottomRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ── Track if user is near bottom (so we know whether to auto-scroll on new msg) ──
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottomRef.current = distanceFromBottom < 80
  }

  // ── Realtime — new message INSERT for this thread ──
  useEffect(() => {
    const channel = supabase
      .channel(`thread-view-${threadId}`)
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        async (payload: any) => {
          const m = payload?.new
          if (!m) return
          if (messageIdSetRef.current.has(m.id)) return

          // Re-fetch the thread payload so we get the message WITH its
          // joined sender AND signed-URL'd attachments. This is heavier
          // than just adding the one message but it ensures attachment
          // URLs are properly signed (which a direct supabase select
          // can't do — the API generates them server-side).
          //
          // Tradeoff: every new message in any open thread triggers a
          // small refetch. Acceptable for typical chat volume; we'd
          // optimize if we hit scale.
          try {
            const res = await fetch(`/api/messages/threads/${threadId}`)
            if (!res.ok) return
            const data = await res.json()
            if (Array.isArray(data.messages)) {
              const ids = new Set<string>(data.messages.map((mm: Message) => mm.id))
              messageIdSetRef.current = ids
              setMessages(data.messages)
            }
          } catch { /* silent */ }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [threadId])

  // ── Auto-scroll on new message (only if user is near bottom) ──
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      // Defer to next paint so the new message is rendered first
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      })
    }
  }, [messages.length])

  // ── Mark as read ──
  // After load + after each new message, debounce-mark the latest
  // visible message as read.
  useEffect(() => {
    if (loading || messages.length === 0) return
    const lastId = messages[messages.length - 1].id
    const t = window.setTimeout(() => {
      fetch(`/api/messages/threads/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_read_message_id: lastId }),
      }).catch(() => { /* silent */ })
    }, 800)
    return () => clearTimeout(t)
  }, [loading, messages.length, threadId, messages])

  // Send/keyboard handling lives inside MessageComposer now.

  // ── Render ──
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={onBack} className="mt-4 text-sm text-slate-600 underline">Back</button>
      </div>
    )
  }

  const memberCount = members.length
  const subtitleParts: string[] = []
  if (thread) {
    if (thread.target_kind === 'all_company') subtitleParts.push('Everyone')
    else if (thread.target_kind === 'job_title') subtitleParts.push(thread.target_job_title || 'Group')
    if (memberCount > 0) subtitleParts.push(`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-slate-200 bg-white sticky top-0 z-10 flex items-center gap-2">
        <button onClick={onBack} className="text-slate-600 hover:text-slate-900 px-2 py-1 text-sm">
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-900 truncate">
            {thread?.title || (members.length > 0 && thread?.target_kind === 'user_list'
              ? members.filter(m => m.id !== currentUserId).map(m => m.full_name).join(', ') || 'Direct message'
              : (thread?.target_kind === 'all_company' ? 'Everyone' : (thread?.target_job_title || 'Thread')))}
          </p>
          {subtitleParts.length > 0 && (
            <p className="text-xs text-slate-500 truncate">{subtitleParts.join(' · ')}</p>
          )}
        </div>
        <button onClick={() => setShowMembers(true)} className="text-slate-400 hover:text-slate-700 p-2 text-sm">
          ⓘ
        </button>
      </div>

      {/* Members modal */}
      {showMembers && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowMembers(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Members ({memberCount})</h2>
              <button onClick={() => setShowMembers(false)} className="text-slate-500 text-xl leading-none">×</button>
            </div>
            <ul className="overflow-y-auto divide-y divide-slate-100">
              {members.map(m => (
                <li key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-semibold">
                    {(m.full_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 truncate">
                      {m.full_name}{m.id === currentUserId && <span className="text-slate-400 ml-1">(you)</span>}
                    </p>
                    {m.job_title && <p className="text-xs text-slate-500 truncate">{m.job_title}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-slate-50 px-3 py-4"
      >
        {loading ? (
          <p className="text-slate-400 italic text-sm text-center py-8">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-slate-400 italic text-sm text-center py-8">No messages yet — say hi 👋</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => {
              const isOwn = m.sender_id === currentUserId
              const prev = i > 0 ? messages[i - 1] : null
              const showSender = !prev || prev.sender_id !== m.sender_id || (
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000
              )
              return (
                <div key={m.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] sm:max-w-[70%]`}>
                    {showSender && !isOwn && (
                      <p className="text-[10px] text-slate-500 mb-0.5 ml-3">
                        {m.sender?.full_name || 'Unknown'}
                        <span className="ml-1.5 text-slate-400">{formatTime(m.created_at)}</span>
                      </p>
                    )}
                    {showSender && isOwn && (
                      <p className="text-[10px] text-slate-400 mb-0.5 mr-3 text-right">
                        {formatTime(m.created_at)}
                      </p>
                    )}
                    <div className="space-y-1">
                      {/* Attachments */}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                          {m.attachments.map(a => (
                            <AttachmentTile
                              key={a.id}
                              attachment={a}
                              onOpen={(url, name) => setLightbox({ url, filename: name })}
                            />
                          ))}
                        </div>
                      )}
                      {/* Text body — only if non-empty */}
                      {m.body && m.body.trim() !== '' && (
                        <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                          isOwn
                            ? `${ownBubble} rounded-br-sm`
                            : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
                        }`}>
                          {m.body}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white text-3xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={lightbox.filename}
            className="max-w-full max-h-full object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Composer */}
      <MessageComposer
        threadId={threadId}
        accent={accent}
        onSent={() => {
          // Force scroll-to-bottom on next paint, then refetch to show
          // own message immediately (realtime would deliver too, but a
          // direct refetch is snappier for the sender).
          isAtBottomRef.current = true
          load()
        }}
      />
    </div>
  )
}

/** Inline tile for an attachment in a message bubble. */
function AttachmentTile({
  attachment,
  onOpen,
}: {
  attachment: Attachment
  onOpen: (url: string, filename: string) => void
}) {
  if (!attachment.signed_url) {
    // Storage signing failed — show a fallback
    return (
      <div className="text-xs text-slate-400 italic px-2 py-1">
        [unavailable: {attachment.filename}]
      </div>
    )
  }
  if (attachment.is_image) {
    return (
      <button
        type="button"
        onClick={() => onOpen(attachment.signed_url!, attachment.filename)}
        className="block rounded-xl overflow-hidden border border-slate-200 hover:opacity-90 transition"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.signed_url}
          alt={attachment.filename}
          className="max-w-[260px] sm:max-w-[320px] max-h-[320px] object-cover"
          loading="lazy"
        />
      </button>
    )
  }
  // PDFs / other docs — file card
  return (
    <a
      href={attachment.signed_url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 transition max-w-[260px] sm:max-w-[320px]"
    >
      <span className="text-2xl flex-shrink-0">📄</span>
      <div className="min-w-0">
        <p className="text-sm text-slate-800 truncate">{attachment.filename}</p>
        <p className="text-[10px] text-slate-500">
          {formatBytes(attachment.size_bytes)} · {attachment.mime_type.split('/').pop()?.toUpperCase()}
        </p>
      </div>
    </a>
  )
}

function formatBytes(n: number | null): string {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
