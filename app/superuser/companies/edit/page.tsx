'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Company = {
  id: string
  name: string
  is_active: boolean
  start_date: string | null
  end_date: string | null
  override_end_date: string | null
}

export default function CompaniesListPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Initial load
  const load = async (q: string) => {
    setLoading(true)
    setError('')
    try {
      const url = q
        ? `/api/list-companies?q=${encodeURIComponent(q)}`
        : '/api/list-companies'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setCompanies(data.companies || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load('') }, [])

  // Debounced search reload
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Reactivate an inactive company. Mirror of soft-delete-restore for
  // users, except companies use is_active rather than is_deleted.
  // Doesn't re-enable any subscription dates — admin can adjust those
  // by clicking into the company's edit form afterwards.
  const handleReactivate = async (c: Company, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Reactivate ${c.name}?\n\nThe company will be marked active. Subscription dates aren't changed — adjust them in the edit form if needed.`)) return
    setInfo('')
    setError('')
    try {
      const res = await fetch('/api/update-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, is_active: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reactivate')
      setInfo(`${c.name} reactivated.`)
      await load(search.trim())
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate')
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex justify-between items-baseline mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        <Link
          href="/superuser/companies/create"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm"
        >
          + Create Company
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="w-full max-w-sm border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {info && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">
          {info}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-slate-400 italic text-center">Loading…</p>
        ) : companies.length === 0 ? (
          <p className="p-8 text-slate-400 italic text-center">
            {search ? 'No companies match your search.' : 'No companies yet. Create one above.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {companies.map(c => {
              const effectiveEnd = c.override_end_date || c.end_date
              const isExpired = effectiveEnd && new Date(effectiveEnd) < new Date()
              return (
                <li key={c.id} className={c.is_active ? '' : 'bg-slate-50'}>
                  <div className="flex items-stretch">
                    <button
                      onClick={() => router.push(`/superuser/companies/edit/${c.id}`)}
                      className="flex-1 text-left p-4 hover:bg-slate-100 transition flex items-center justify-between min-w-0"
                    >
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${c.is_active ? 'text-slate-800' : 'text-slate-500'}`}>
                          {c.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {c.start_date ? `From ${c.start_date}` : 'No start date'}
                          {effectiveEnd ? ` — to ${effectiveEnd}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!c.is_active && (
                          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">Inactive</span>
                        )}
                        {isExpired && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Expired</span>
                        )}
                        <span className="text-slate-400">›</span>
                      </div>
                    </button>
                    {!c.is_active && (
                      <button
                        onClick={(e) => handleReactivate(c, e)}
                        className="flex-shrink-0 px-4 my-2 mr-2 bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium rounded-lg transition"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!loading && companies.length > 0 && (
        <p className="text-xs text-slate-500 mt-3">
          {companies.length} {companies.length === 1 ? 'company' : 'companies'}
        </p>
      )}
    </div>
  )
}

