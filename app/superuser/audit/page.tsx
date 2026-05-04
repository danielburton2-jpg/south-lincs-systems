'use client'

/**
 * /superuser/audit
 *
 * Audit log viewer. Lists rows from public.audit_logs, newest first,
 * with date-range, actor email, action, and entity filters.
 *
 * Wrapped by /superuser/layout.tsx (so non-superusers are redirected
 * before this page ever renders).
 *
 * Pagination is cursor-based on created_at. The first request returns
 * up to 100 rows; "Older →" loads the next page using the oldest
 * visible row's timestamp as the cursor. Page state isn't persisted
 * across navigation — refresh resets to "newest 100".
 */

import { useEffect, useState, useCallback, useRef, Fragment } from 'react'

// ── Types ─────────────────────────────────────────────────────────
type AuditLogRow = {
  id: number
  user_id: string | null
  user_email: string | null
  user_role: string | null
  action: string
  entity: string | null
  entity_id: string | null
  details: Record<string, any> | null
  ip_address: string | null
  created_at: string
}

// Hard-coded list of all the action verbs we know about, alphabetised.
// Lifted from a `SELECT DISTINCT action FROM audit_logs` snapshot. New
// actions added later won't appear in the dropdown — but they'll still
// show up in the table when relevant rows are loaded. The dropdown is
// for filtering, not for completeness.
const KNOWN_ACTIONS = [
  'ADJUST_HOLIDAY_BALANCE',
  'ADMIN_CREATE_HOLIDAY',
  'APPROVE_CANCEL_HOLIDAY',
  'APPROVE_HOLIDAY_REQUEST',
  'BULK_SAVE_DAY_SHEET_ASSIGNMENTS',
  'BULK_SAVE_DRIVER_DAY_ASSIGNMENTS',
  'CHECK_ITEM_CREATED',
  'CHECK_TEMPLATE_RESET',
  'CREATE_COMPANY',
  'CREATE_DAY_SHEET',
  'CREATE_HOLIDAY_REQUEST',
  'CREATE_USER',
  'DEFECT_ASSIGNED',
  'DEFECT_RESOLVED',
  'LINK_DAY_SHEETS',
  'LOGIN_FAILED',
  'LOGIN_SUCCESS',
  'LOGOUT',
  'ON_CALL_SLOT_CREATED',
  'ON_CALL_SLOT_DELETED',
  'ON_CALL_SLOT_UPDATED',
  'ON_CALL_SPLIT_TIME_CHANGED',
  'PHONE_DIRECTORY_ADMIN_UNLOCKED',
  'PHONE_DIRECTORY_CODE_SET',
  'PHONE_DIRECTORY_ENTRY_CREATED',
  'PHONE_DIRECTORY_UNLOCKED',
  'PUBLISH_DAY_SHEET_ASSIGNMENTS',
  'REJECT_HOLIDAY_REQUEST',
  'REQUEST_CANCEL_HOLIDAY',
  'RESTORE_USER',
  'SCHEDULE_ASSIGNMENTS_PUBLISHED',
  'SCHEDULE_ASSIGNMENTS_SAVED',
  'SCHEDULE_CREATED',
  'SOFT_DELETE_USER',
  'UPDATE_COMPANY',
  'UPDATE_COMPANY_FEATURE_SETTINGS',
  'UPDATE_DAY_SHEET',
  'UPDATE_USER',
  'USERS_REORDERED',
  'VEHICLE_CREATED',
  'VEHICLE_UPDATED',
]

// ── Helpers ───────────────────────────────────────────────────────
const formatDateTime = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Default the "from" date to 7 days ago, "to" to today
const todayIso = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const sevenDaysAgoIso = (): string => {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const roleBadgeColor = (role: string | null): string => {
  switch (role) {
    case 'superuser': return 'bg-purple-100 text-purple-700'
    case 'admin':     return 'bg-blue-100 text-blue-700'
    case 'manager':   return 'bg-emerald-100 text-emerald-700'
    case 'user':      return 'bg-slate-100 text-slate-700'
    default:          return 'bg-slate-100 text-slate-500'
  }
}

// Compact one-line summary of the details JSON. For known structures
// (company_name, target_user_email, etc.) we pull useful bits. For
// everything else we just show the keys.
const summariseDetails = (d: Record<string, any> | null): string => {
  if (!d) return ''
  const bits: string[] = []
  if (typeof d.company_name === 'string')          bits.push(`company: ${d.company_name}`)
  if (typeof d.email === 'string')                 bits.push(`email: ${d.email}`)
  if (typeof d.role === 'string')                  bits.push(`role: ${d.role}`)
  if (typeof d.target_user_email === 'string')     bits.push(`target: ${d.target_user_email}`)
  if (typeof d.created_user_email === 'string')    bits.push(`created: ${d.created_user_email}`)
  if (Array.isArray(d.fields))                     bits.push(`fields: ${d.fields.join(', ')}`)
  if (typeof d.attempted_email === 'string')       bits.push(`tried: ${d.attempted_email}`)
  if (bits.length === 0) {
    const keys = Object.keys(d).slice(0, 3).join(', ')
    return keys || ''
  }
  return bits.join(' · ')
}

// ── Component ─────────────────────────────────────────────────────
export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Filters — controlled inputs. Applied on submit + on filter change
  // (via a small debounce for the actor text input).
  const [from, setFrom] = useState<string>(sevenDaysAgoIso())
  const [to, setTo] = useState<string>(todayIso())
  const [actor, setActor] = useState<string>('')
  const [action, setAction] = useState<string>('')

  // Count of currently-loaded rows for the footer
  const loadedCount = rows.length

  // Build the query string for the API
  const buildQs = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams()
    if (from)   params.set('from', from)
    if (to)     params.set('to', to)
    if (actor)  params.set('actor', actor.trim())
    if (action) params.set('action', action)
    if (cursor) params.set('before', cursor)
    return params.toString()
  }, [from, to, actor, action])

  // Initial / filter-change load — replaces the list
  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError('')
    setExpandedId(null)
    try {
      const res = await fetch(`/api/superuser/audit-logs?${buildQs()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setRows(data.rows || [])
      setNextCursor(data.next_cursor || null)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [buildQs])

  // "Older" — appends to the list
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/superuser/audit-logs?${buildQs(nextCursor)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load more')
      setRows(prev => [...prev, ...(data.rows || [])])
      setNextCursor(data.next_cursor || null)
    } catch (e: any) {
      setError(e.message || 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  // Debounced re-fetch when filters change. Date and dropdown changes
  // fire immediately; the actor text input gets a 300ms debounce to
  // avoid one fetch per keystroke.
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      loadFirstPage()
      return
    }
    const t = setTimeout(loadFirstPage, 300)
    return () => clearTimeout(t)
  }, [from, to, actor, action, loadFirstPage])

  const resetFilters = () => {
    setFrom(sevenDaysAgoIso())
    setTo(todayIso())
    setActor('')
    setAction('')
  }

  const toggleExpanded = (id: number) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
        <p className="text-sm text-slate-500 mt-1">
          Recent events recorded by the system. Newest first.
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Actor email</label>
            <input
              type="search"
              value={actor}
              onChange={e => setActor(e.target.value)}
              placeholder="Substring match"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Action</label>
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All actions</option>
              {KNOWN_ACTIONS.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <button
              onClick={resetFilters}
              className="w-full text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-2 rounded-lg"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-slate-400 italic text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-slate-400 italic text-center">No events match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-medium text-slate-600">
                  <th className="px-4 py-3 whitespace-nowrap">When</th>
                  <th className="px-4 py-3 whitespace-nowrap">Who</th>
                  <th className="px-4 py-3 whitespace-nowrap">Role</th>
                  <th className="px-4 py-3 whitespace-nowrap">Action</th>
                  <th className="px-4 py-3 whitespace-nowrap">Entity</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map(r => {
                  const isExpanded = expandedId === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggleExpanded(r.id)}
                        className="cursor-pointer hover:bg-slate-50 transition"
                      >
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-700 align-top">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-800 align-top">
                          {r.user_email || <span className="text-slate-400 italic">none</span>}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap align-top">
                          {r.user_role ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeColor(r.user_role)}`}>
                              {r.user_role}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-xs text-slate-700 align-top">
                          {r.action}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-600 align-top">
                          {r.entity || <span className="text-slate-400 italic">—</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-600 align-top">
                          <span className="text-xs">{summariseDetails(r.details)}</span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="px-4 py-3">
                            <dl className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                              <div>
                                <dt className="text-slate-500 font-medium">Audit ID</dt>
                                <dd className="font-mono text-slate-700">{r.id}</dd>
                              </div>
                              <div>
                                <dt className="text-slate-500 font-medium">User ID</dt>
                                <dd className="font-mono text-slate-700 break-all">
                                  {r.user_id || <span className="italic text-slate-400">none</span>}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500 font-medium">Entity ID</dt>
                                <dd className="font-mono text-slate-700 break-all">
                                  {r.entity_id || <span className="italic text-slate-400">none</span>}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500 font-medium">IP address</dt>
                                <dd className="font-mono text-slate-700">
                                  {r.ip_address || <span className="italic text-slate-400">none</span>}
                                </dd>
                              </div>
                              <div className="md:col-span-3">
                                <dt className="text-slate-500 font-medium mb-1">Details (JSON)</dt>
                                <dd>
                                  <pre className="bg-white border border-slate-200 rounded p-2 text-xs overflow-x-auto whitespace-pre">
{r.details ? JSON.stringify(r.details, null, 2) : 'null'}
                                  </pre>
                                </dd>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-500">
              Showing {loadedCount} {loadedCount === 1 ? 'event' : 'events'}
              {nextCursor ? ' (more available)' : ''}
            </p>
            {nextCursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Older →'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
