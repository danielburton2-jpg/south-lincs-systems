'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import UserForm, { type UserFormUser } from '@/components/UserForm'

const supabase = createClient()

export default function DashboardEditUserPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params?.id as string | undefined

  const [initial, setInitial] = useState<Partial<UserFormUser> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!userId) return
    const load = async () => {
      try {
        // Get my company so we can fetch users
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }
        const { data: me } = await supabase
          .from('profiles')
          .select('company_id, role')
          .eq('id', user.id).single()
        if (!me?.company_id) throw new Error('No company assigned')
        if (me.role !== 'admin') { router.push('/dashboard'); return }

        const res = await fetch('/api/get-company-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: me.company_id }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')
        const u = (data.users || []).find((x: any) => x.id === userId)
        if (!u) throw new Error('User not found in your company')
        if (cancelled) return

        setInitial({
          id: u.id,
          full_name: u.full_name || '',
          email: u.email || '',
          role: u.role || 'user',
          job_title: u.job_title || '',
          employee_number: u.employee_number || '',
          employment_start_date: u.employment_start_date || '',
          holiday_entitlement: u.holiday_entitlement,
          full_year_entitlement: u.full_year_entitlement,
          working_days: u.working_days,
          user_features: u.user_features || [],
          manager_titles: u.manager_titles || [],
          extra_fields: u.extra_fields || {},
        })
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load user')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, router])

  if (loading) return <div className="p-8 text-slate-400 italic">Loading user…</div>
  if (error) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-medium mb-1">Couldn&apos;t load user</p>
          <p className="text-sm">{error}</p>
          <button onClick={() => router.push('/dashboard/users')}
            className="mt-3 text-sm underline">
            Back to users
          </button>
        </div>
      </div>
    )
  }
  if (!initial) return null

  return <UserForm mode="edit" initial={initial} userId={userId} />
}
