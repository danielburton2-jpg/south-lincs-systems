'use client'
/**
 * ThreadList
 *
 * Renders the user's list of message threads. Adds a per-row action
 * menu (… button) that, for 1-on-1 threads, offers "Remove from my
 * list" — a personal hide that doesn't affect the other user.
 */
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Thread = {
  id: string
  display_title: string
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  target_kind: 'user_list' | 'job_title' | 'all_company'
  target_job_title: string | null
}

const supabase = createClient()

type Props = {
  onOpenThread: (threadId: string) => void
  onCompose: () => void
  accent?: 'slate' | 'indigo'
}

export default function ThreadList({ onOpenThread, onCompose, accent = 'slate' }: Props) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [hidingId, setHidingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/threads')
      const data = await res.json()
      if (res.ok && Array.isArray(data.threads)) setThreads(data.threads)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Realtime — silently re-load when any messaging table changes for
  // the current user. The hide table is also subscribed so explicit
  // hide/unhide actions update the list.
  useEffect(() => {
    const channel = supabase
      .channel('thread-list')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => load(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_threads' },
        () => load(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_thread_members' },
        () => load(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'thread_hidden_by' },
        () => load(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Close the open row menu when clicking elsewhere
  useEffect(() => {
    if (!menuOpenId) return
    const close = () => setMenuOpenId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpenId])

  const handleHide = async (threadId: string) => {
    setMenuOpenId(null)
    setHidingId(threadId)
    try {
      // Optimistic — remove from local list immediately
      setThreads(prev => prev.filter(t => t.id !== threadId))
      const res = await fetch(`/api/messages/threads/${threadId}/hide`, {
        method: 'POST',
      })
      if (!res.ok) {
        // Reload on failure to restore correct state
        load()
      }
    } finally {
      setHidingId(null)
    }
  }

  const filtered = threads.filter(t => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      t.display_title.toLowerCase().includes(q) ||
      (t.last_message_preview || '').toLowerCase().includes(q)
    )
  })

  const accentBg = accent === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="🔍 Search threads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            type="button"
            onClick={onCompose}
            className={`${accentBg} text-white px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0`}
          >
            + New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        {loading ? (
          <div className="p-8 text-slate-400 italic text-sm">Loading messages…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-5xl mb-3">💬</p>
            <p className="text-slate-700 font-medium">
              {threads.length === 0 ? 'No messages yet' : 'No matches'}
            </p>
            {threads.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Tap <span className="font-semibold">+ New</span> to start a conversation.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map(t => (
              <li key={t.id} className={`relative ${hidingId === t.id ? 'opacity-50' : ''}`}>
                <button
                  type="button"
                  onClick={() => onOpenThread(t.id)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-start gap-3"
                >
                  <ThreadAvatar thread={t} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`font-semibold text-sm truncate ${t.unread_count > 0 ? 'text-slate-900' : 'text-slate-700'}`}>
                        {t.display_title}
                      </p>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {formatRelativeTime(t.last_message_at)}
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${t.unread_count > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                      {t.last_message_preview || <span className="italic text-slate-400">No messages yet</span>}
                    </p>
                  </div>
                  {t.unread_count > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center flex-shrink-0">
                      {t.unread_count > 9 ? '9+' : t.unread_count}
                    </span>
                  )}
                </button>

                {/* Row action menu trigger — only for user_list threads */}
                {t.target_kind === 'user_list' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpenId(menuOpenId === t.id ? null : t.id)
                    }}
                    className="absolute top-3 right-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded p-1 text-sm"
                    aria-label="Thread actions"
                  >
                    ⋯
                  </button>
                )}

                {menuOpenId === t.id && (
                  <div
                    className="absolute top-10 right-2 z-20 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[180px]"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleHide(t.id)}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      🗑 Remove from my list
                    </button>
                    <p className="px-3 pt-1 pb-2 text-[10px] text-slate-400 leading-tight">
                      Doesn&apos;t affect the other person. New messages bring it back.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ThreadAvatar({ thread }: { thread: Thread }) {
  let icon: React.ReactNode
  if (thread.target_kind === 'all_company') icon = '🏢'
  else if (thread.target_kind === 'job_title') icon = '👥'
  else {
    const letter = (thread.display_title || '?').charAt(0).toUpperCase()
    icon = letter
  }

  return (
    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-sm flex-shrink-0">
      {icon}
    </div>
  )
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24 && d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' })
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
