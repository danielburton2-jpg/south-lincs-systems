'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}
const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1', class_2: 'Class 2', bus: 'Bus', coach: 'Coach', minibus: 'Minibus',
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const daysUntil = (dateStr: string | null): number | null => {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const target = new Date(dateStr); target.setHours(0,0,0,0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

const status = (days: number | null): { label: string; color: string; rank: number } => {
  if (days === null) return { label: '—',  color: 'text-slate-400 bg-slate-50',   rank: 99 }
  if (days < 0)     return { label: `${Math.abs(days)}d overdue`, color: 'text-red-700 bg-red-100',     rank: 0 }
  if (days <= 14)   return { label: `${days}d`, color: 'text-amber-800 bg-amber-100',  rank: 1 }
  if (days <= 30)   return { label: `${days}d`, color: 'text-yellow-800 bg-yellow-50', rank: 2 }
  return { label: `${days}d`, color: 'text-green-700 bg-green-50', rank: 3 }
}

export default function FleetComplianceReport() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>('all')

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)
    if (!profile.company_id) { router.push('/dashboard'); return }
    if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'superuser') {
      router.push('/dashboard'); return
    }

    const { data: companyData } = await supabase
      .from('companies').select('*, company_features (is_enabled, features (name))').eq('id', profile.company_id).single()
    setCompany(companyData)
    const hasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Services & MOT'
    )
    if (!hasFeature) { router.push('/dashboard'); return }

    const { data: vehData } = await supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', profile.company_id)
      .eq('active', true)
      .order('registration')
    setVehicles(vehData || [])
    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Stats and sorted list
  const { sortedVehicles, summary } = useMemo(() => {
    const enriched = (filterType === 'all' ? vehicles : vehicles.filter(v => v.vehicle_type === filterType))
      .map(v => {
        const items = [
          { label: 'Service', days: daysUntil(v.next_service_due) },
          { label: 'MOT',     days: daysUntil(v.mot_expiry_date) },
          { label: 'Tacho',   days: daysUntil(v.tacho_calibration_date) },
          { label: 'Tax',     days: daysUntil(v.tax_due_date) },
          { label: 'LOLER',   days: daysUntil(v.loler_due_date) },
        ]
        const worstRank = items.reduce((min, i) => {
          if (i.days === null) return min
          return Math.min(min, status(i.days).rank)
        }, 99)
        return { vehicle: v, items, worstRank }
      })
      .sort((a, b) => a.worstRank - b.worstRank || a.vehicle.registration.localeCompare(b.vehicle.registration))

    const summary = {
      total: enriched.length,
      overdue: enriched.filter(e => e.worstRank === 0).length,
      due14: enriched.filter(e => e.worstRank === 1).length,
      due30: enriched.filter(e => e.worstRank === 2).length,
      compliant: enriched.filter(e => e.worstRank === 3).length,
      noData: enriched.filter(e => e.worstRank === 99).length,
    }
    return { sortedVehicles: enriched, summary }
  }, [vehicles, filterType])

  const total = summary.overdue + summary.due14 + summary.due30 + summary.compliant + summary.noData
  const pct = (n: number) => total > 0 ? (n / total) * 100 : 0

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

    // Header
    doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text(`${company?.name || 'Fleet'} — Compliance Snapshot`, 14, 18)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Generated ${today}`, 14, 24)
    doc.text(`Active vehicles: ${summary.total}  •  Overdue: ${summary.overdue}  •  Due ≤14 days: ${summary.due14}  •  Compliant: ${summary.compliant}`, 14, 29)

    autoTable(doc, {
      startY: 35,
      head: [['Reg', 'Fleet #', 'Type', 'Service', 'MOT', 'Tacho', 'Tax', 'LOLER', 'Mileage']],
      body: sortedVehicles.map(({ vehicle, items }) => ([
        vehicle.registration,
        vehicle.fleet_number || '—',
        VEHICLE_TYPE_LABELS[vehicle.vehicle_type] || vehicle.vehicle_type,
        items[0].days === null ? '—' : (items[0].days < 0 ? `${Math.abs(items[0].days)}d overdue` : `${items[0].days}d`),
        items[1].days === null ? '—' : (items[1].days < 0 ? `${Math.abs(items[1].days)}d overdue` : `${items[1].days}d`),
        items[2].days === null ? '—' : (items[2].days < 0 ? `${Math.abs(items[2].days)}d overdue` : `${items[2].days}d`),
        items[3].days === null ? '—' : (items[3].days < 0 ? `${Math.abs(items[3].days)}d overdue` : `${items[3].days}d`),
        items[4].days === null ? '—' : (items[4].days < 0 ? `${Math.abs(items[4].days)}d overdue` : `${items[4].days}d`),
        vehicle.current_mileage ? Number(vehicle.current_mileage).toLocaleString() : '—',
      ])),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      didParseCell: (data: any) => {
        // Color cells red/amber based on days
        if (data.section === 'body' && data.column.index >= 3 && data.column.index <= 7) {
          const text = String(data.cell.raw || '')
          if (text.includes('overdue')) {
            data.cell.styles.fillColor = [254, 226, 226]
            data.cell.styles.textColor = [185, 28, 28]
            data.cell.styles.fontStyle = 'bold'
          } else if (text.endsWith('d') && !text.includes('—')) {
            const n = parseInt(text, 10)
            if (n <= 14) {
              data.cell.styles.fillColor = [254, 243, 199]
              data.cell.styles.textColor = [180, 83, 9]
            }
          }
        }
      },
    })

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8); doc.setTextColor(150)
      doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 25, doc.internal.pageSize.getHeight() - 8)
      doc.text('Generated by South Lincs Systems', 14, doc.internal.pageSize.getHeight() - 8)
    }

    doc.save(`compliance-${company?.name?.replace(/[^a-z0-9]/gi, '_') || 'fleet'}-${isoDate(new Date())}.pdf`)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Fleet Compliance Snapshot</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportPDF}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
          >
            📄 Export PDF
          </button>
          <button
            onClick={() => router.push('/dashboard/services/reports')}
            className="text-sm text-slate-600 hover:text-slate-800"
          >
            ← Reports
          </button>
        </div>
      </div>

      <div className="space-y-4">

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-slate-800">{summary.total}</p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-red-700">{summary.overdue}</p>
            <p className="text-xs text-red-700">Overdue</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{summary.due14}</p>
            <p className="text-xs text-amber-700">Due in 14 days</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-yellow-700">{summary.due30}</p>
            <p className="text-xs text-yellow-700">Due in 30 days</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{summary.compliant}</p>
            <p className="text-xs text-green-700">Compliant</p>
          </div>
        </div>

        {/* Stacked horizontal bar visualisation */}
        {total > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-2">
            <div className="text-sm font-semibold text-slate-700">Compliance distribution</div>
            <div className="flex w-full h-6 rounded-lg overflow-hidden border border-slate-200">
              {summary.overdue > 0 && <div className="bg-red-500" style={{ width: `${pct(summary.overdue)}%` }} title={`${summary.overdue} overdue`}></div>}
              {summary.due14 > 0 && <div className="bg-amber-400" style={{ width: `${pct(summary.due14)}%` }} title={`${summary.due14} due in 14 days`}></div>}
              {summary.due30 > 0 && <div className="bg-yellow-300" style={{ width: `${pct(summary.due30)}%` }} title={`${summary.due30} due in 30 days`}></div>}
              {summary.compliant > 0 && <div className="bg-green-500" style={{ width: `${pct(summary.compliant)}%` }} title={`${summary.compliant} compliant`}></div>}
              {summary.noData > 0 && <div className="bg-slate-300" style={{ width: `${pct(summary.noData)}%` }} title={`${summary.noData} no data`}></div>}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-red-500 rounded"></span>Overdue ({summary.overdue})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-amber-400 rounded"></span>≤14 days ({summary.due14})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-yellow-300 rounded"></span>≤30 days ({summary.due30})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-green-500 rounded"></span>Compliant ({summary.compliant})</span>
              {summary.noData > 0 && <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-slate-300 rounded"></span>No data ({summary.noData})</span>}
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-center gap-3">
          <label className="text-sm text-slate-600">Vehicle type:</label>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="all">All</option>
            <option value="class_1">🚛 Class 1</option>
            <option value="class_2">🚚 Class 2</option>
            <option value="bus">🚌 Bus</option>
            <option value="coach">🚍 Coach</option>
            <option value="minibus">🚐 Minibus</option>
          </select>
        </div>

        {/* The big table */}
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-700 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Vehicle</th>
                <th className="px-3 py-2 text-center">Service</th>
                <th className="px-3 py-2 text-center">MOT</th>
                <th className="px-3 py-2 text-center">Tacho</th>
                <th className="px-3 py-2 text-center">Tax</th>
                <th className="px-3 py-2 text-center">LOLER</th>
                <th className="px-3 py-2 text-right">Mileage</th>
              </tr>
            </thead>
            <tbody>
              {sortedVehicles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500 py-8">No vehicles match the filter.</td>
                </tr>
              ) : sortedVehicles.map(({ vehicle, items }, idx) => (
                <tr key={vehicle.id} className={`border-t border-slate-100 ${idx % 2 ? 'bg-slate-50/30' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{VEHICLE_TYPE_ICONS[vehicle.vehicle_type] || '🚗'}</span>
                      <div>
                        <p className="font-mono font-bold text-slate-800">{vehicle.registration}</p>
                        <p className="text-[10px] text-slate-500">
                          {vehicle.fleet_number ? `#${vehicle.fleet_number} • ` : ''}
                          {VEHICLE_TYPE_LABELS[vehicle.vehicle_type]}
                        </p>
                      </div>
                    </div>
                  </td>
                  {items.map((it, i) => {
                    const st = status(it.days)
                    return (
                      <td key={i} className="px-2 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-600">
                    {vehicle.current_mileage ? Number(vehicle.current_mileage).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
