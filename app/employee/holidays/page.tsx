'use client'

/**
 * /employee/holidays — employee booking + history.
 *
 * The booking form is now the shared <HolidayRequestForm /> component.
 * This page handles:
 *   • Hero header (warm amber-orange)
 *   • Balance display
 *   • The "+ New Request" toggle that swaps in the form
 *   • The list of existing requests + detail view
 *   • Bottom nav
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getUKBankHolidays } from '@/lib/bankHolidays'
import HolidayRequestForm from '@/components/HolidayRequestForm'

const supabase = createClient()

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function EmployeeHolidays() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success'|'error'>('success')

  const showMessage = (msg: string, type: 'success'|'error') => {
    setMessage(msg); setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: p } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, job_title, company_id, holiday_entitlement, working_days')
        .eq('id', user.id).single()
      if (!p) { router.push('/login'); return }
      setProfile(p)

      // Permission check
      if (p.role === 'admin') {
        setHasAccess(true)
      } else {
        const { data: holidaysFeature } = await supabase
          .from('features').select('id').eq('slug', 'holidays').single()
        if (holidaysFeature) {
          const { data: uf } = await supabase
            .from('user_features')
            .select('is_enabled, can_view, can_edit')
            .eq('user_id', user.id)
            .eq('feature_id', holidaysFeature.id)
            .maybeSingle()
          setHasAccess(!!(uf?.can_view || uf?.can_edit || uf?.is_enabled))
        }
      }

      if (p.company_id) {
        const { data: c } = await supabase
          .from('companies')
          .select('id, name, holiday_year_start, allow_half_days, allow_early_finish')
          .eq('id', p.company_id).single()
        setCompany(c)
      }

      const res = await fetch('/api/get-holiday-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, scope: 'mine' }),
      })
      const data = await res.json()
      if (res.ok && Array.isArray(data.requests)) setRequests(data.requests)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadAll()
    getUKBankHolidays().then(d => setBankHolidays(d.dates))
  }, [loadAll])

  const handleCancel = async (req: any) => {
    if (req.status === 'pending') {
      if (!confirm('Cancel this pending request?')) return
      await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_pending', request_id: req.id, user_id: profile.id }),
      })
      showMessage('Request cancelled', 'success')
    } else if (req.status === 'approved') {
      if (!confirm('Send a cancellation request? Your days will be returned if approved.')) return
      await fetch('/api/holiday-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_cancel', request_id: req.id, user_id: profile.id }),
      })
      showMessage('Cancellation requested', 'success')
    }
    setSelected(null)
    loadAll()
  }

  const balance = Number(profile?.holiday_entitlement || 0)

  const typeIcon = (t: string) =>
    t === 'holiday' ? '🏖️' : t === 'early_finish' ? '🕓' : t === 'keep_day_off' ? '🚫' : '📅'
  const typeLabel = (t: string) =>
    t === 'holiday' ? 'Holiday' : t === 'early_finish' ? 'Early Finish' : t === 'keep_day_off' ? 'Keep Day Off' : t

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string]> = {
      pending:        ['Pending',                'bg-yellow-100 text-yellow-700'],
      approved:       ['Approved',               'bg-green-100 text-green-700'],
      rejected:       ['Rejected',               'bg-red-100 text-red-700'],
      cancelled:      ['Cancelled',              'bg-slate-100 text-slate-600'],
      cancel_pending: ['Cancellation pending',   'bg-orange-100 text-orange-700'],
    }
    const [label, cls] = map[status] || [status, 'bg-slate-100 text-slate-600']
    return <span className={`text-xs px-2 py-1 rounded-full font-medium ${cls}`}>{label}</span>
  }

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center bg-slate-50"><p className="text-slate-400">Loading…</p></main>
  }

  if (!hasAccess) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-lg font-bold text-slate-800 mb-2">No access</h1>
          <p className="text-sm text-slate-600 mb-4">
            You don&apos;t have access to Holidays. Speak to your manager if you think this is a mistake.
          </p>
          <button onClick={() => router.push('/employee')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-xl w-full">
            Back to Home
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-amber-400 to-orange-500 text-white px-6 pt-10 pb-8 rounded-b-[2rem] shadow-xl">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative">
          <button onClick={() => router.push('/employee')} className="text-white/90 text-sm mb-2 inline-flex items-center gap-1">
            ← Back
          </button>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold">Holidays</h1>
              <p className="text-white/85 text-sm mt-1">Manage your time off</p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-bold leading-none">{balance}</p>
              <p className="text-xs text-white/85 mt-1">days left this year</p>
            </div>
          </div>
        </div>
      </header>

      <div className="px-5 pt-5 space-y-4">
        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>{message}</div>
        )}

        {!showForm && !selected && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white py-4 rounded-2xl font-semibold shadow-md transition"
          >
            + New Request
          </button>
        )}

        {/* FORM */}
        {showForm && (
          <HolidayRequestForm
            profile={profile}
            company={company}
            bankHolidays={bankHolidays}
            variant="employee"
            onSubmitted={() => { setShowForm(false); loadAll() }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* DETAIL */}
        {selected && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Request Details</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-3">
              <Row label="Type" value={`${typeIcon(selected.request_type)} ${typeLabel(selected.request_type)}`} />
              <Row label="Date" value={selected.start_date === selected.end_date
                ? formatDate(selected.start_date)
                : `${formatDate(selected.start_date)} → ${formatDate(selected.end_date)}`} />
              {selected.half_day_type && <Row label="Half Day" value={selected.half_day_type} />}
              {selected.early_finish_time && <Row label="Finish Time" value={selected.early_finish_time} />}
              {selected.request_type === 'holiday' && (
                <Row label="Days" value={String(selected.days_requested)} />
              )}
              {selected.request_type === 'holiday' && !selected.is_current_year && (
                <Row label="Year" value={`${selected.holiday_year_label} (next year)`} />
              )}
              <div>
                <p className="text-xs text-slate-500 uppercase">Status</p>
                <div className="mt-1">{statusBadge(selected.status)}</div>
              </div>
              {selected.reason && <Row label="Reason" value={selected.reason} />}
              {selected.review_notes && <Row label="Reviewer Notes" value={selected.review_notes} italic />}
              {selected.status === 'pending' && (
                <button onClick={() => handleCancel(selected)}
                  className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 py-3 rounded-xl font-medium transition">
                  Cancel Request
                </button>
              )}
              {selected.status === 'approved' && (
                <button onClick={() => handleCancel(selected)}
                  className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 py-3 rounded-xl font-medium transition">
                  Request Cancellation
                </button>
              )}
              {selected.status === 'cancel_pending' && (
                <div className="bg-orange-50 border border-orange-200 text-orange-700 p-3 rounded-xl text-sm text-center">
                  Cancellation pending approval
                </div>
              )}
            </div>
          </div>
        )}

        {/* LIST */}
        {!showForm && !selected && (
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">Your Requests</h2>
            {requests.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-100 text-center">
                <p className="text-slate-400 text-sm">No requests yet. Tap &quot;New Request&quot; above.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {requests.map(req => (
                  <li key={req.id} onClick={() => setSelected(req)}
                    className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-2xl">{typeIcon(req.request_type)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 truncate">
                            {req.start_date === req.end_date
                              ? formatDate(req.start_date)
                              : `${formatDate(req.start_date)} → ${formatDate(req.end_date)}`}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <p className="text-xs text-slate-500">{typeLabel(req.request_type)}</p>
                            {req.request_type === 'holiday' && (
                              <p className="text-xs text-slate-500">• {req.days_requested} days</p>
                            )}
                            {req.request_type === 'holiday' && !req.is_current_year && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Next year</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-2">{statusBadge(req.status)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM NAV — hidden when form is open (sticky submit takes its place) */}
      {!showForm && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg">
          <div className="flex justify-around items-center h-16 max-w-md mx-auto">
            <button onClick={() => router.push('/employee')}
              className="flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg text-slate-400 hover:text-slate-600 transition">
              <span className="text-xl" aria-hidden>🏠</span>
              <span className="text-xs font-medium">Home</span>
            </button>
            <button onClick={() => router.push('/employee/profile')}
              className="flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg text-slate-400 hover:text-slate-600 transition">
              <span className="text-xl" aria-hidden>👤</span>
              <span className="text-xs font-medium">Profile</span>
            </button>
          </div>
        </nav>
      )}
    </main>
  )
}

function Row({ label, value, italic }: { label: string; value: string; italic?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500 uppercase">{label}</p>
      <p className={`text-slate-800 ${italic ? 'italic' : 'font-medium'}`}>{value}</p>
    </div>
  )
}
