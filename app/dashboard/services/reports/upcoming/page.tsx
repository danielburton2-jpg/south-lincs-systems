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

const SERVICE_LABELS: Record<string, string> = {
  service: 'Service', mot: 'MOT', tacho: 'Tacho', tax: 'Tax (VED)', loler: 'LOLER',
}

const SERVICE_TO_TYPE: Record<string, string> = {
  service: 'safety_inspection', mot: 'mot_prep', tacho: 'tacho', tax: 'tax', loler: 'loler',
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const daysUntil = (dateStr: string | null): number | null => {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const target = new Date(dateStr); target.setHours(0,0,0,0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export default function UpcomingReport() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [windowDays, setWindowDays] = useState<number>(30) // upcoming horizon
  const [serviceFilter, setServiceFilter] = useState<string>('all')

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
    setVehicles(vehData || [])
    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Build flat list of (vehicle, service_type, due_date, days)
  const items = useMemo(() => {
    const out: any[] = []
    vehicles.forEach(v => {
      const fields: { key: string; date: string | null }[] = [
        { key: 'service', date: v.next_service_due },
        { key: 'mot',     date: v.mot_expiry_date },
        { key: 'tacho',   date: v.tacho_calibration_date },
        { key: 'tax',     date: v.tax_due_date },
        { key: 'loler',   date: v.loler_due_date },
      ]
      fields.forEach(f => {
        if (!f.date) return
        const d = daysUntil(f.date)
        if (d === null) return
        out.push({ vehicle: v, kind: f.key, due_date: f.date, days: d })
      })
    })
    return out
  }, [vehicles])

  const filtered = useMemo(() => {
    return items
      .filter(i => i.days <= windowDays)
      .filter(i => serviceFilter === 'all' ? true : i.kind === serviceFilter)
      .sort((a, b) => a.days - b.days)
  }, [items, windowDays, serviceFilter])

  const goSchedule = (it: any) => {
    const serviceType = SERVICE_TO_TYPE[it.kind]
    router.push(`/dashboard/services/schedule?vehicle_id=${it.vehicle.id}&service_type=${serviceType}`)
  }

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    const horizonLabel = windowDays >= 9999 ? 'all upcoming' :
      windowDays === 0 ? 'overdue only' : `next ${windowDays} days`

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(`${company?.name || 'Fleet'} — Upcoming Services`, 14, 18)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Generated ${today}`, 14, 24)
    doc.text(`Window: ${horizonLabel}  •  ${filtered.length} item${filtered.length === 1 ? '' : 's'}`, 14, 29)

    autoTable(doc, {
      startY: 35,
      head: [['Reg', 'Fleet #', 'Type', 'Service', 'Due', 'Status']],
      body: filtered.map(i => [
        i.vehicle.registration,
        i.vehicle.fleet_number || '—',
        i.vehicle.vehicle_type.replace('_', ' '),
        SERVICE_LABELS[i.kind] || i.kind,
        new Date(i.due_date).toLocaleDateString('en-GB'),
        i.days < 0 ? `${Math.abs(i.days)} days overdue` : `in ${i.days} days`,
      ]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 5) {
          const text = String(data.cell.raw || '')
          if (text.includes('overdue')) {
            data.cell.styles.fillColor = [254, 226, 226]
            data.cell.styles.textColor = [185, 28, 28]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    const pageCount = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8); doc.setTextColor(150)
      doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 25, doc.internal.pageSize.getHeight() - 8)
      doc.text('Generated by South Lincs Systems', 14, doc.internal.pageSize.getHeight() - 8)
    }

    doc.save(`upcoming-${company?.name?.replace(/[^a-z0-9]/gi, '_') || 'fleet'}-${isoDate(new Date())}.pdf`)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  const overdueCount = filtered.filter(i => i.days < 0).length

  return (
    <div className="p-8 max-w-5xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Overdue &amp; Upcoming</h1>
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

        {/* Filter row */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-slate-600 font-medium">Show:</span>
          {[
            { v: 0,    label: 'Overdue only' },
            { v: 14,   label: 'Next 14 days' },
            { v: 30,   label: 'Next 30 days' },
            { v: 90,   label: 'Next 90 days' },
            { v: 9999, label: 'All upcoming' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setWindowDays(opt.v)}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium ${
                windowDays === opt.v ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}>
              {opt.label}
            </button>
          ))}
          <select value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}
            className="ml-2 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="all">All service types</option>
            {Object.entries(SERVICE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto">
            {filtered.length} item{filtered.length === 1 ? '' : 's'}{overdueCount > 0 && ` • ${overdueCount} overdue`}
          </span>
        </div>

        {/* List */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-5xl mb-3">✅</p>
              <p className="text-slate-500">Nothing in this window. Fleet's looking good.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((i, idx) => {
                const isOverdue = i.days < 0
                const isImminent = i.days >= 0 && i.days <= 14
                return (
                  <li key={`${i.vehicle.id}-${i.kind}-${idx}`} className={`p-3 flex items-center gap-3 ${
                    isOverdue ? 'bg-red-50/40' : isImminent ? 'bg-amber-50/40' : ''
                  }`}>
                    <span className="text-2xl flex-shrink-0">{VEHICLE_TYPE_ICONS[i.vehicle.vehicle_type] || '🚗'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-bold text-slate-800">{i.vehicle.registration}</p>
                        {i.vehicle.fleet_number && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">#{i.vehicle.fleet_number}</span>
                        )}
                        <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{SERVICE_LABELS[i.kind]}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Due {new Date(i.due_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className={`text-sm font-bold whitespace-nowrap px-3 py-1 rounded-full ${
                      isOverdue ? 'bg-red-100 text-red-700' :
                      isImminent ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {isOverdue ? `${Math.abs(i.days)}d overdue` : `${i.days}d`}
                    </div>
                    <button onClick={() => goSchedule(i)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap">
                      Schedule →
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  )
}
