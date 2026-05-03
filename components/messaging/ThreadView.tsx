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
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Message = {
  id: string
  thread_id: string
  sender_id: string
  body: string | null
  created_at: string
  edited_at: string | null
  sender: { id: string; full_name: string; job_title: string | null } | null
  attachments: any[]
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
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [error, setError] = useState('')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const messageIdSetRef = useRef<Set<string>>(new Set())

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
          // Avoid double-add if our own send already optimistically pushed
          if (messageIdSetRef.current.has(m.id)) return

          // We need sender info that the realtime payload doesn't include.
          // Cheapest path: re-fetch the single message (with its joined sender).
          // Could maintain a cache of senders, but this scales fine for now.
          const { data: full } = await supabase
            .from('messages')
            .select(`
              id, thread_id, sender_id, body, created_at, edited_at,
              sender:profiles!messages_sender_id_fkey(id, full_name, job_title)
            `)
            .eq('id', m.id)
            .single()

          if (full) {
            messageIdSetRef.current.add(full.id)
            setMessages(prev => [...prev, { ...(full as any), attachments: [] }])
          }
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

  // ── Send a message ──
  const handleSend = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setDraft('')
    try {
      const res = await fetch(`/api/messages/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send')
        setDraft(text)  // restore
      } else if (data.message) {
        // Realtime will pick this up too — but optimistic-add for snappiness.
        if (!messageIdSetRef.current.has(data.message.id)) {
          messageIdSetRef.current.add(data.message.id)
          // Need sender info — synthesize from current user since we know it's us
          setMessages(prev => [...prev, {
            ...data.message,
            sender: { id: currentUserId, full_name: 'You', job_title: null },
            attachments: [],
          }])
        }
        // Force scroll-to-bottom after sending own message
        isAtBottomRef.current = true
      }
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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
                    <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      isOwn
                        ? `${ownBubble} rounded-br-sm`
                        : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
                    }`}>
                      {m.body}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white px-3 py-3 sticky bottom-0">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none px-3 py-2 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 max-h-32"
            disabled={sending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className={`${accentBg} text-white px-4 py-2 rounded-2xl text-sm font-medium disabled:opacity-50 flex-shrink-0`}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
