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
  const [isMuted, setIsMuted] = useState(false)
  const [callerRole, setCallerRole] = useState<string>('user')
  // Inline message edit state — only one message can be in edit mode at a time
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

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
      setIsMuted(!!data.is_muted)
      setCallerRole(data.caller_role || 'user')
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

  // Close per-message menu on outside click
  useEffect(() => {
    if (!messageMenuId) return
    const close = () => setMessageMenuId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [messageMenuId])

  // ── Mute toggle ──
  const handleToggleMute = async () => {
    const want = !isMuted
    setIsMuted(want)
    try {
      const res = await fetch(`/api/messages/threads/${threadId}/${want ? 'mute' : 'unmute'}`, {
        method: 'POST',
      })
      if (!res.ok) {
        // Revert
        setIsMuted(!want)
      }
    } catch {
      setIsMuted(!want)
    }
  }

  // ── Edit message ──
  const beginEdit = (m: Message) => {
    if (m.sender_id !== currentUserId) return
    setEditingMessageId(m.id)
    setEditDraft(m.body || '')
    setMessageMenuId(null)
  }

  const saveEdit = async () => {
    if (!editingMessageId) return
    const id = editingMessageId
    const newBody = editDraft.trim()
    if (newBody.length === 0) return
    setEditingMessageId(null)
    setEditDraft('')
    // Optimistic
    setMessages(prev => prev.map(m =>
      m.id === id ? { ...m, body: newBody, edited_at: new Date().toISOString() } : m
    ))
    const res = await fetch(`/api/messages/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newBody }),
    })
    if (!res.ok) {
      load()  // Reload to revert on failure
    }
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }

  // ── Delete message ──
  const handleDelete = async (messageId: string) => {
    setConfirmDeleteId(null)
    setMessageMenuId(null)
    // Optimistic remove
    setMessages(prev => prev.filter(m => m.id !== messageId))
    messageIdSetRef.current.delete(messageId)
    const res = await fetch(`/api/messages/messages/${messageId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      // Reload to restore on failure
      load()
    }
  }

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
            {(() => {
              // Manual thread title takes priority
              if (thread?.title) return thread.title

              // user_list: show the OTHER members' names. While members
              // are still loading, show a placeholder rather than the
              // misleading 'Thread' label.
              if (thread?.target_kind === 'user_list') {
                const others = members.filter(m => m.id !== currentUserId)
                if (others.length === 0) {
                  // Either still loading or this thread genuinely has
                  // no other members. The latter shouldn't happen.
                  return loading ? 'Loading…' : 'Conversation'
                }
                return others.map(m => m.full_name).join(', ')
              }

              // job_title and all_company group threads
              if (thread?.target_kind === 'all_company') return 'Everyone'
              if (thread?.target_kind === 'job_title') return thread.target_job_title || 'Group'

              // Genuinely unknown — only happens if thread metadata
              // hasn't loaded yet
              return loading ? 'Loading…' : 'Conversation'
            })()}
          </p>
          {subtitleParts.length > 0 && (
            <p className="text-xs text-slate-500 truncate">{subtitleParts.join(' · ')}</p>
          )}
        </div>
        <button onClick={() => setShowMembers(true)} className="text-slate-400 hover:text-slate-700 p-2 text-sm flex items-center gap-1">
          {isMuted && <span className="text-xs" title="Muted">🔕</span>}
          ⓘ
        </button>
      </div>

      {/* Thread info modal — members, title, mute, admin actions */}
      {showMembers && (
        <ThreadInfoModal
          thread={thread}
          members={members}
          currentUserId={currentUserId}
          callerRole={callerRole}
          isMuted={isMuted}
          onClose={() => setShowMembers(false)}
          onToggleMute={handleToggleMute}
          onChanged={() => load()}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDeleteId(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-slate-900 mb-2">Delete message?</h2>
            <p className="text-sm text-slate-600 mb-4">
              This message will be removed for everyone in the thread, including any attached files. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId!)}
                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg"
              >
                Delete
              </button>
            </div>
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
              const isAdmin = callerRole === 'admin'
              const canEditOrDelete = isOwn && isAdmin
              const isEditing = editingMessageId === m.id
              const isMenuOpen = messageMenuId === m.id
              const prev = i > 0 ? messages[i - 1] : null
              const showSender = !prev || prev.sender_id !== m.sender_id || (
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000
              )
              return (
                <div key={m.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] relative`}>
                    {showSender && !isOwn && (
                      <p className="text-[10px] text-slate-500 mb-0.5 ml-3">
                        {m.sender?.full_name || 'Unknown'}
                        <span className="ml-1.5 text-slate-400">
                          {formatTime(m.created_at)}
                          {m.edited_at && <span className="italic"> · edited</span>}
                        </span>
                      </p>
                    )}
                    {showSender && isOwn && (
                      <p className="text-[10px] text-slate-400 mb-0.5 mr-3 text-right">
                        {formatTime(m.created_at)}
                        {m.edited_at && <span className="italic"> · edited</span>}
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

                      {/* Text body or inline editor */}
                      {isEditing ? (
                        <div className={`rounded-2xl px-2 py-1.5 ${isOwn ? ownBubble : 'bg-white border border-slate-200'}`}>
                          <textarea
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={2}
                            className={`w-full bg-transparent text-sm outline-none resize-none ${
                              isOwn ? 'text-white placeholder-white/60' : 'text-slate-800 placeholder-slate-400'
                            }`}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 mt-1 text-[11px]">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className={isOwn ? 'text-white/80 hover:text-white' : 'text-slate-500 hover:text-slate-800'}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={editDraft.trim().length === 0}
                              className={`font-semibold ${isOwn ? 'text-white' : 'text-slate-800'} disabled:opacity-50`}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        m.body && m.body.trim() !== '' && (
                          <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            isOwn
                              ? `${ownBubble} rounded-br-sm`
                              : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
                          }`}>
                            {m.body}
                          </div>
                        )
                      )}
                    </div>

                    {/* Admin own-message ⋯ menu */}
                    {canEditOrDelete && !isEditing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMessageMenuId(isMenuOpen ? null : m.id)
                        }}
                        className={`absolute ${isOwn ? '-left-7' : '-right-7'} top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-700 px-1 py-0.5 text-sm opacity-0 group-hover:opacity-100 transition-opacity`}
                        aria-label="Message actions"
                      >
                        ⋯
                      </button>
                    )}

                    {isMenuOpen && (
                      <div
                        className={`absolute z-30 ${isOwn ? 'right-0' : 'left-0'} top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[140px]`}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => beginEdit(m)}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMessageMenuId(null); setConfirmDeleteId(m.id) }}
                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          🗑 Delete
                        </button>
                      </div>
                    )}
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

// ─────────────────────────────────────────────────────────────────
// ThreadInfoModal
//
// The expanded ⓘ panel. Shows:
//   • Thread title (admin-editable)
//   • Mute toggle (admin only)
//   • Members list (admin add/remove for user_list threads)
// ─────────────────────────────────────────────────────────────────

function ThreadInfoModal({
  thread,
  members,
  currentUserId,
  callerRole,
  isMuted,
  onClose,
  onToggleMute,
  onChanged,
}: {
  thread: Thread | null
  members: Member[]
  currentUserId: string
  callerRole: string
  isMuted: boolean
  onClose: () => void
  onToggleMute: () => void
  onChanged: () => void
}) {
  const isAdmin = callerRole === 'admin'
  const isUserList = thread?.target_kind === 'user_list'

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(thread?.title || '')
  const [savingTitle, setSavingTitle] = useState(false)

  // Add-member state
  const [showAddMember, setShowAddMember] = useState(false)
  const [companyUsers, setCompanyUsers] = useState<Member[]>([])
  const [pickedUserId, setPickedUserId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  // Load company users for the add-member picker. Lazy — only when
  // the admin opens the picker.
  useEffect(() => {
    if (!showAddMember) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, job_title, role')
        .order('full_name', { ascending: true })
      if (!cancelled) {
        setCompanyUsers(((data || []) as Member[])
          .filter(p => !members.some(m => m.id === p.id)))
      }
    })()
    return () => { cancelled = true }
  }, [showAddMember, members])

  const saveTitle = async () => {
    if (!thread) return
    setSavingTitle(true)
    setActionError('')
    try {
      const res = await fetch(`/api/messages/threads/${thread.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || 'Could not save title')
        return
      }
      setEditingTitle(false)
      onChanged()
    } finally {
      setSavingTitle(false)
    }
  }

  const handleAdd = async () => {
    if (!pickedUserId || !thread) return
    setAdding(true)
    setActionError('')
    try {
      const res = await fetch(`/api/messages/threads/${thread.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: pickedUserId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || 'Could not add')
        return
      }
      setPickedUserId('')
      setShowAddMember(false)
      onChanged()
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!thread) return
    setRemovingId(userId)
    setActionError('')
    try {
      const res = await fetch(`/api/messages/threads/${thread.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || 'Could not remove')
        return
      }
      onChanged()
    } finally {
      setRemovingId(null)
    }
  }

  const memberCount = members.length

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Thread info</h2>
          <button onClick={onClose} className="text-slate-500 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto">
          {/* Title section */}
          <section className="px-4 py-3 border-b border-slate-100">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Title</p>
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  placeholder="Optional thread title"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={saveTitle}
                  disabled={savingTitle}
                  className="text-sm font-semibold text-slate-800 hover:text-slate-900 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingTitle(false); setTitleDraft(thread?.title || '') }}
                  className="text-sm text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-slate-800">
                  {thread?.title || (
                    <span className="italic text-slate-400">No custom title</span>
                  )}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => { setEditingTitle(true); setTitleDraft(thread?.title || '') }}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    ✏️ Edit
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Mute section — admin only */}
          {isAdmin && (
            <section className="px-4 py-3 border-b border-slate-100">
              <button
                type="button"
                onClick={onToggleMute}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <p className="text-sm text-slate-800">
                    {isMuted ? '🔕 Notifications muted' : '🔔 Notifications on'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {isMuted
                      ? 'No phone pings or in-app toasts for this thread.'
                      : 'You\u2019ll receive in-app toasts and phone pings.'}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 inline-block w-10 h-6 rounded-full transition relative ${
                    isMuted ? 'bg-slate-300' : 'bg-slate-800'
                  }`}
                  aria-hidden
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                      isMuted ? 'left-0.5' : 'left-[18px]'
                    }`}
                  />
                </span>
              </button>
            </section>
          )}

          {/* Members section */}
          <section className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Members ({memberCount})
              </p>
              {isAdmin && isUserList && !showAddMember && (
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  className="text-xs text-slate-700 hover:text-slate-900 font-medium"
                >
                  + Add member
                </button>
              )}
            </div>

            {/* Add-member picker — admin + user_list only */}
            {showAddMember && (
              <div className="bg-slate-50 rounded-lg p-2 mb-3 border border-slate-100">
                {companyUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 italic px-2 py-2">
                    Everyone in your company is already in this thread.
                  </p>
                ) : (
                  <>
                    <select
                      value={pickedUserId}
                      onChange={e => setPickedUserId(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 mb-2"
                    >
                      <option value="">Pick someone…</option>
                      {companyUsers.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.full_name}{u.job_title ? ` — ${u.job_title}` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setShowAddMember(false); setPickedUserId('') }}
                        className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!pickedUserId || adding}
                        className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-medium px-3 py-1 rounded-lg disabled:opacity-50"
                      >
                        {adding ? '…' : 'Add'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Member rows */}
            {memberCount === 0 ? (
              <p className="text-xs text-slate-400 italic">
                {thread?.target_kind === 'all_company'
                  ? 'Everyone in your company.'
                  : (thread?.target_kind === 'job_title'
                      ? `Anyone with the job title \u201c${thread?.target_job_title || ''}\u201d.`
                      : 'No members yet.')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 -mx-1">
                {members.map(m => {
                  const canRemove = isAdmin && isUserList && m.id !== currentUserId
                  return (
                    <li key={m.id} className="px-1 py-2 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-semibold">
                        {(m.full_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">
                          {m.full_name}
                          {m.id === currentUserId && (
                            <span className="text-slate-400 ml-1">(you)</span>
                          )}
                        </p>
                        {m.job_title && (
                          <p className="text-xs text-slate-500 truncate">{m.job_title}</p>
                        )}
                      </div>
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          className="text-xs text-red-600 hover:text-red-800 px-2 py-1 disabled:opacity-50"
                        >
                          {removingId === m.id ? '…' : 'Remove'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Note for live group threads */}
            {!isUserList && memberCount > 0 && (
              <p className="text-[11px] text-slate-400 italic mt-2">
                {thread?.target_kind === 'all_company'
                  ? 'Membership is automatic — everyone in your company.'
                  : 'Membership is automatic — anyone with this job title joins live.'}
              </p>
            )}
          </section>

          {actionError && (
            <p className="px-4 pb-3 text-xs text-red-600">{actionError}</p>
          )}
        </div>
      </div>
    </div>
  )
}

