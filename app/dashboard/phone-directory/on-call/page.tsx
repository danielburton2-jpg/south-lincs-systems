'use client'

/**
 * /dashboard/phone-directory/on-call
 *
 * Standalone admin page for the on-call rota. Wrapped in
 * AdminPinGate so admin types their PIN on every fresh visit.
 *
 * The actual on-call manager UI lives in
 * components/phone-directory/OnCallManager.tsx — it's reused both
 * here and (historically) in the Manage page (no longer; the rota
 * was moved out for clearer sidebar navigation).
 *
 * Note on entries: the OnCallManager needs the directory entries
 * list to render its picker. We fetch them on mount so the manager
 * gets a fresh list. (Admins might add a new entry on the Manage
 * page, then come here to assign them.)
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import AdminPinGate from '@/components/admin/AdminPinGate'
import OnCallManager from '@/components/phone-directory/OnCallManager'
import PhoneDirectoryAlertBanner from '@/components/PhoneDirectoryAlertBanner'

const supabase = createClient()

type Entry = {
  id: string
  name: string
  phone_number: string
  notes: string | null
}

export default function AdminOnCallPage() {
  return (
    <AdminPinGate title="Phone Directory · On-Call Rota">
      <OnCallContents />
    </AdminPinGate>
  )
}

function OnCallContents() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      // Confirm admin role before fetching
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, company_id')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!profile?.company_id || profile.role !== 'admin') {
        setError('Admins only')
        setLoading(false)
        return
      }

      // Fetch the directory entries (admins bypass the unlock cookie)
      try {
        const res = await fetch('/api/phone-directory/entries')
        if (cancelled) return
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error || 'Failed to load directory entries')
        } else {
          setEntries(data.entries || [])
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Server error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="p-8 text-slate-400 italic">Loading…</div>
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-4">
        <p className="text-sm text-slate-500">
          Pick someone (or a phone, like an on-call mobile) from the directory
          and assign them to a date range and time window. Drivers see the
          person on call at the top of their phone directory while on call.
          Phone numbers are never shown on the on-call surfaces — only names —
          but the directory the rota points at still has the numbers behind
          the scenes for tap-to-call.
        </p>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <PhoneDirectoryAlertBanner showResetButton />

      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <OnCallManager entries={entries} entriesVersion={0} />
      </section>
    </div>
  )
}
