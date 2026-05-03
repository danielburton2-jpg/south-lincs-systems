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
                <li key={c.id}>
                  <button
                    onClick={() => router.push(`/superuser/companies/edit/${c.id}`)}
                    className="w-full text-left p-4 hover:bg-slate-50 transition flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {c.start_date ? `From ${c.start_date}` : 'No start date'}
                        {effectiveEnd ? ` — to ${effectiveEnd}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.is_active && (
                        <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">Inactive</span>
                      )}
                      {isExpired && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Expired</span>
                      )}
                      <span className="text-slate-400">›</span>
                    </div>
                  </button>
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

