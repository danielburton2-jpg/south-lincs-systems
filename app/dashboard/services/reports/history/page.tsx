'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛', class_2: '🚚', bus: '🚌', coach: '🚍', minibus: '🚐',
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  safety_inspection: 'Safety Inspection',
  full_service:      'Full Service',
  mot_prep:          'MOT Prep',
  tacho:             'Tacho Calibration',
  loler:             'LOLER',
  tax:               'Tax (VED)',
  custom:            'Custom',
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function VehicleHistoryReport() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('')
  const [records, setRecords] = useState<any[]>([])
  const [profilesById, setProfilesById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(false)

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
      .select('id, registration, fleet_number, name, vehicle_type, current_mileage')
      .eq('company_id', profile.company_id)
      .order('registration')
    setVehicles(vehData || [])

    // Load profiles for mechanic name lookups
    const usersRes = await fetch('/api/get-company-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: profile.company_id }),
    })
    const usersResult = await usersRes.json()
    const map: Record<string, string> = {}
    ;(usersResult?.users || []).forEach((u: any) => {
      map[u.id] = u.full_name
    })
    setProfilesById(map)

    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Load records when a vehicle is picked
  useEffect(() => {
    if (!selectedVehicleId) { setRecords([]); return }
    setRecordsLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('service_records')
        .select('*')
        .eq('vehicle_id', selectedVehicleId)
        .order('performed_date', { ascending: false })
      setRecords(data || [])
      setRecordsLoading(false)
    })()
  }, [selectedVehicleId])

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId)

  const exportPDF = () => {
    if (!selectedVehicle) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

    // Header
    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(`${company?.name || ''} — Service History`, 14, 18)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text(`${selectedVehicle.registration}${selectedVehicle.fleet_number ? `  •  Fleet #${selectedVehicle.fleet_number}` : ''}`, 14, 25)
    if (selectedVehicle.name) {
      doc.setFontSize(9); doc.setTextColor(100)
      doc.text(selectedVehicle.name, 14, 30)
      doc.setTextColor(0)
    }
    doc.setFontSize(8); doc.setTextColor(120)
    doc.text(`Generated ${today}  •  ${records.length} record${records.length === 1 ? '' : 's'}`, 14, 35)
    doc.setTextColor(0)

    autoTable(doc, {
      startY: 42,
      head: [['Date', 'Service', 'Outcome', 'Defects', 'Mileage', 'Mechanic']],
      body: records.map(r => [
        r.performed_date ? new Date(r.performed_date).toLocaleDateString('en-GB') : '—',
        SERVICE_TYPE_LABELS[r.service_type] || r.service_type,
        r.signature ? (r.pass ? 'PASS' : 'FAIL') : 'IN PROGRESS',
        r.defects_found || 0,
        r.end_mileage ? Number(r.end_mileage).toLocaleString() : '—',
        profilesById[r.performed_by] || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 2) {
          const text = String(data.cell.raw || '')
          if (text === 'PASS') {
            data.cell.styles.fillColor = [220, 252, 231]
            data.cell.styles.textColor = [22, 101, 52]
            data.cell.styles.fontStyle = 'bold'
          } else if (text === 'FAIL') {
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

    doc.save(`history-${selectedVehicle.registration}-${isoDate(new Date())}.pdf`)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading…</div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Vehicle Service History</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <div className="flex gap-3">
          {selectedVehicle && (
            <button
              onClick={exportPDF}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              📄 Export PDF
            </button>
          )}
          <button
            onClick={() => router.push('/dashboard/services/reports')}
            className="text-sm text-slate-600 hover:text-slate-800"
          >
            ← Reports
          </button>
        </div>
      </div>

      <div className="space-y-4">

        {/* Vehicle picker */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">Select a vehicle</label>
          <select value={selectedVehicleId} onChange={e => setSelectedVehicleId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white">
            <option value="">— pick a vehicle —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>
                {VEHICLE_TYPE_ICONS[v.vehicle_type] || '🚗'} {v.registration}
                {v.fleet_number ? ` (#${v.fleet_number})` : ''}
                {v.name ? ` — ${v.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        {!selectedVehicleId ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
            <p className="text-5xl mb-3">📜</p>
            <p className="text-slate-500">Pick a vehicle above to see its service history.</p>
          </div>
        ) : recordsLoading ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
            <p className="text-slate-500">Loading history...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
            <p className="text-5xl mb-3">📭</p>
            <p className="text-slate-500">No service records yet for this vehicle.</p>
          </div>
        ) : (
          <>
            {/* Vehicle info banner */}
            {selectedVehicle && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
                <strong>{selectedVehicle.registration}</strong>
                {selectedVehicle.fleet_number && <> • Fleet #{selectedVehicle.fleet_number}</>}
                {selectedVehicle.name && <> • {selectedVehicle.name}</>}
                {selectedVehicle.current_mileage && <> • {Number(selectedVehicle.current_mileage).toLocaleString()} mi</>}
                <span className="float-right text-xs text-blue-700 font-medium">{records.length} record{records.length === 1 ? '' : 's'}</span>
              </div>
            )}

            {/* History list */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {records.map(r => {
                  const isComplete = !!r.signature
                  return (
                    <li key={r.id} className="p-4 hover:bg-slate-50 cursor-pointer"
                      onClick={() => router.push(`/employee/services/${r.id}`)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-slate-800">
                              {SERVICE_TYPE_LABELS[r.service_type] || r.service_type}
                            </p>
                            {!isComplete ? (
                              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">In progress</span>
                            ) : r.pass ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">✓ PASS</span>
                            ) : (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">✗ FAIL</span>
                            )}
                            {r.defects_found > 0 && (
                              <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">{r.defects_found} defect{r.defects_found > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mt-1">
                            {r.performed_date ? new Date(r.performed_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                            {r.performed_by && profilesById[r.performed_by] && <> • {profilesById[r.performed_by]}</>}
                            {r.end_mileage && <> • {Number(r.end_mileage).toLocaleString()} mi</>}
                          </p>
                          {r.mot_certificate_expiry && (
                            <p className="text-xs text-indigo-700 mt-0.5">📋 New MOT cert expires: {new Date(r.mot_certificate_expiry).toLocaleDateString('en-GB')}</p>
                          )}
                          {r.notes && (
                            <p className="text-xs text-slate-500 italic mt-1 line-clamp-2">{r.notes}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-blue-600 hover:underline">View →</p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
