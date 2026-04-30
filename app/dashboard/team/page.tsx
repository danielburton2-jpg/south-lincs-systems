'use client'

/**
 * /dashboard/team — manager team view (read-only).
 *
 * Lists only people the manager oversees (people whose job_title is in
 * the manager's manager_job_titles list). No edit, freeze or remove
 * actions — managers can't change other users' records.
 *
 * Admins shouldn't reach this page — bounce them to /dashboard/users.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type User = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  job_title: string | null
  employee_number: string | null
  holiday_entitlement: number | null
  is_frozen: boolean
}

export default function DashboardTeamPage() {
  const router = useRouter()
  const [team, setTeam] = useState<User[]>([])
  const [companyName, setCompanyName] = useState('')
  const [titles, setTitles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, company_id')
        .eq('id', user.id).single()
      if (!profile?.company_id) return

      // Admins shouldn't be here
      if (profile.role === 'admin') { router.push('/dashboard/users'); return }
      if (profile.role !== 'manager') { router.push('/dashboard'); return }

      // Company name
      const cRes = await fetch(`/api/get-company?id=${encodeURIComponent(profile.company_id)}`)
      const cData = await cRes.json()
      if (cRes.ok) setCompanyName(cData.company?.name || '')

      // Manager's titles
      const { data: titlesData } = await supabase
        .from('manager_job_titles')
        .select('job_title')
        .eq('manager_id', user.id)
      const myTitles = (titlesData || []).map((t: any) => t.job_title)
      setTitles(myTitles)

      // All users → filter to my titles
      const uRes = await fetch('/api/get-company-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: profile.company_id }),
      })
      const uData = await uRes.json()
      if (Array.isArray(uData.users)) {
        const myTeam = uData.users.filter((u: any) =>
          u.job_title && myTitles.includes(u.job_title) && u.id !== user.id,
        )
        setTeam(myTeam)
      }
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':   return 'bg-purple-100 text-purple-700'
      case 'manager': return 'bg-blue-100 text-blue-700'
      case 'user':    return 'bg-slate-100 text-slate-700'
      default:        return 'bg-slate-100 text-slate-700'
    }
  }

  if (loading) return <div className="p-8 text-slate-400 italic">Loading team…</div>

  if (titles.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">My Team</h1>
        <p className="text-sm text-slate-500 mb-6">{companyName}</p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          You haven&apos;t been assigned any job titles to manage yet. Ask your admin to set this on your user record.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">My Team</h1>
      <p className="text-sm text-slate-500 mb-2">{companyName}</p>
      <p className="text-xs text-slate-500 mb-6">
        Showing staff with job titles: <strong>{titles.join(', ')}</strong>
      </p>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Team Members ({team.length})</h3>
        {team.length === 0 ? (
          <p className="text-sm text-slate-400 italic">
            No team members yet. Ask your admin to add users with one of your assigned job titles.
          </p>
        ) : (
          <ul className="space-y-3">
            {team.map(u => (
              <li key={u.id} className={`border rounded-xl p-4 ${
                u.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
              }`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-800">{u.full_name || u.email}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeColor(u.role)}`}>
                    {u.role}
                  </span>
                  {u.employee_number && (
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                      {u.employee_number}
                    </span>
                  )}
                  {u.job_title && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {u.job_title}
                    </span>
                  )}
                  {u.holiday_entitlement !== null && u.holiday_entitlement !== undefined && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                      🏖️ {u.holiday_entitlement} days
                    </span>
                  )}
                  {u.is_frozen && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Frozen</span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">{u.email}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
