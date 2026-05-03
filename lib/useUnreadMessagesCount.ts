'use client'
/**
 * useUnreadMessagesCount
 *
 * Returns the total unread message count for the current user.
 * Subscribes to realtime so the badge updates without polling.
 *
 * Used by the dashboard sidebar (admin/manager) and the employee
 * messages tile.
 *
 * Re-fetches on:
 *   • mount
 *   • any new INSERT in `messages` (might affect us)
 *   • any change in `message_reads` (we just opened a thread)
 *
 * Coarse but cheap: each event triggers a single small GET that
 * returns just a number.
 */
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

export function useUnreadMessagesCount(): number {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/unread-count')
      const data = await res.json()
      if (typeof data?.count === 'number') setCount(data.count)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('unread-count')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => refresh(),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_reads' },
        () => refresh(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refresh])

  return count
}
