'use client'

/**
 * /dashboard/phone-directory/on-call
 *
 * Standalone admin page for the on-call rota. NOT PIN-gated —
 * the on-call surface never exposes phone numbers (just names),
 * so admin role + login session is the gate. Step 19 decision.
 *
 * The OnCallManager component does the heavy lifting; this page
 * fetches the directory entries it needs as a picker.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
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
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const init = async () => {
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
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to dashboard</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">On-Call Rota</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick someone (or a phone, like an on-call mobile) from the directory
          and assign them to a date range and time window. Drivers see the
          person on call at the top of their phone directory while on call.
          Phone numbers are never shown on the on-call surfaces — only names.
          Edit numbers on the{' '}
          <Link href="/dashboard/phone-directory" className="text-blue-600 hover:underline">
            Manage page
          </Link>
          .
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
