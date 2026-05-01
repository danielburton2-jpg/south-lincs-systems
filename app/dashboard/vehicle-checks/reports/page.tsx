'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const VEHICLE_TYPE_ICONS: Record<string, string> = {
  class_1: '🚛',
  class_2: '🚚',
  bus: '🚌',
  coach: '🚍',
  minibus: '🚐',
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1',
  class_2: 'Class 2',
  bus: 'Bus',
  coach: 'Coach',
  minibus: 'Minibus',
}

type Tab = 'checks' | 'defects'

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function VehicleReportsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('checks')

  // Filters
  const todayIso = isoDate(new Date())
  const thirtyDaysAgo = isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo)
  const [dateTo, setDateTo] = useState(todayIso)
  const [filterVehicle, setFilterVehicle] = useState<string>('all')
  const [filterDriver, setFilterDriver] = useState<string>('all')
  const [filterDefects, setFilterDefects] = useState<'all' | 'with' | 'without'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'fixed' | 'dismissed'>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')

  // Data
  const [checks, setChecks] = useState<any[]>([])
  const [defects, setDefects] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])

  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/dashboard'); return
    }
    if (!profile.company_id) { router.push('/dashboard'); return }

    const { data: companyData } = await supabase
      .from('companies')
      .select(`*, company_features (is_enabled, features (name))`)
      .eq('id', profile.company_id)
      .single()
    setCompany(companyData)

    const companyHasFeature = companyData?.company_features?.some(
      (cf: any) => cf.is_enabled && cf.features?.name === 'Vehicle Checks'
    )
    if (!companyHasFeature) { router.push('/dashboard'); return }

    const [vehRes, userRes] = await Promise.all([
      supabase.from('vehicles').select('id, registration, fleet_number, vehicle_type, name')
        .eq('company_id', profile.company_id).order('registration'),
      supabase.from('profiles').select('id, full_name, role')
        .eq('company_id', profile.company_id).eq('is_frozen', false).order('full_name'),
    ])
    setVehicles(vehRes.data || [])
    setUsers(userRes.data || [])

    setLoading(false)
  }, [router])

  useEffect(() => { init() }, [init])

  // Load data when filters change
  const loadChecks = useCallback(async () => {
    if (!currentUser?.company_id) return
    let q = supabase
      .from('vehicle_checks')
      .select(`
        *,
        vehicle:vehicles (registration, fleet_number, vehicle_type, name),
        driver:profiles!vehicle_checks_driver_id_fkey (full_name, employee_number)
      `)
      .eq('company_id', currentUser.company_id)
      .not('driver_signature', 'is', null)
      .gte('check_date', dateFrom)
      .lte('check_date', dateTo)
      .order('completed_at', { ascending: false })

    if (filterVehicle !== 'all') q = q.eq('vehicle_id', filterVehicle)
    if (filterDriver !== 'all') q = q.eq('driver_id', filterDriver)
    if (filterDefects === 'with') q = q.eq('has_defects', true)
    if (filterDefects === 'without') q = q.eq('has_defects', false)

    const { data } = await q
    setChecks(data || [])
  }, [currentUser?.company_id, dateFrom, dateTo, filterVehicle, filterDriver, filterDefects])

  const loadDefects = useCallback(async () => {
    if (!currentUser?.company_id) return
    let q = supabase
      .from('vehicle_defects')
      .select(`
        *,
        vehicle:vehicles (registration, fleet_number, vehicle_type, name),
        reporter:profiles!vehicle_defects_reported_by_fkey (full_name),
        resolver:profiles!vehicle_defects_resolved_by_fkey (full_name),
        assignee:profiles!vehicle_defects_assigned_to_fkey (full_name)
      `)
      .eq('company_id', currentUser.company_id)
      .gte('reported_at', dateFrom + 'T00:00:00')
      .lte('reported_at', dateTo + 'T23:59:59')
      .order('reported_at', { ascending: false })

    if (filterVehicle !== 'all') q = q.eq('vehicle_id', filterVehicle)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterAssignee !== 'all') q = q.eq('assigned_to', filterAssignee)

    const { data } = await q
    setDefects(data || [])
  }, [currentUser?.company_id, dateFrom, dateTo, filterVehicle, filterStatus, filterAssignee])

  useEffect(() => {
    if (!loading && tab === 'checks') loadChecks()
  }, [loading, tab, loadChecks])

  useEffect(() => {
    if (!loading && tab === 'defects') loadDefects()
  }, [loading, tab, loadDefects])

  // ─────────────────────────────────────────────────────────
  // PDF / CSV exports
  // ─────────────────────────────────────────────────────────

  const drawHeader = (doc: jsPDF, title: string) => {
    const pageWidth = doc.internal.pageSize.getWidth()

    // Logo placeholder box (top-left)
    doc.setDrawColor(200)
    doc.setFillColor(245, 245, 245)
    doc.rect(15, 12, 30, 18, 'FD')
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text('LOGO', 30, 22, { align: 'center' })

    // Company name (centre)
    doc.setFontSize(14)
    doc.setTextColor(40)
    doc.setFont('helvetica', 'bold')
    doc.text(company?.name || '', pageWidth / 2, 18, { align: 'center' })

    // Title
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.text(title, pageWidth / 2, 25, { align: 'center' })

    // Generated date (right)
    doc.setFontSize(8)
    doc.setTextColor(120)
    const generated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    doc.text(`Generated: ${generated}`, pageWidth - 15, 18, { align: 'right' })
    doc.text(`By: ${currentUser?.full_name || ''}`, pageWidth - 15, 23, { align: 'right' })

    // Bottom border line
    doc.setDrawColor(180)
    doc.line(15, 33, pageWidth - 15, 33)
  }

  const drawFilters = (doc: jsPDF, lines: string[]) => {
    doc.setFontSize(8)
    doc.setTextColor(80)
    doc.setFont('helvetica', 'normal')
    let y = 38
    lines.forEach(line => {
      doc.text(line, 15, y)
      y += 4
    })
    return y + 2
  }

  const drawFooter = (doc: jsPDF) => {
    const pageHeight = doc.internal.pageSize.getHeight()
    const pageWidth = doc.internal.pageSize.getWidth()
    const totalPages = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(140)
      doc.text(
        `Page ${i} of ${totalPages}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: 'center' }
      )
      doc.text('South Lincs Systems', 15, pageHeight - 8)
    }
  }

  const exportChecksPDF = () => {
    setGenerating(true)
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      drawHeader(doc, 'Walk-Round Checks Report')

      const filterLines = [
        `Period: ${new Date(dateFrom).toLocaleDateString('en-GB')} to ${new Date(dateTo).toLocaleDateString('en-GB')}`,
        `Vehicle: ${filterVehicle === 'all' ? 'All vehicles' : vehicles.find(v => v.id === filterVehicle)?.registration || ''}`,
        `Driver: ${filterDriver === 'all' ? 'All drivers' : users.find(u => u.id === filterDriver)?.full_name || ''}`,
        `Defects: ${filterDefects === 'all' ? 'All' : filterDefects === 'with' ? 'With defects' : 'No defects'}`,
        `Total checks: ${checks.length}`,
      ]
      const startY = drawFilters(doc, filterLines)

      autoTable(doc, {
        startY,
        head: [['Date', 'Vehicle', 'Type', 'Driver', 'Mileage', 'Defects']],
        body: checks.map(c => [
          new Date(c.check_date + 'T00:00:00').toLocaleDateString('en-GB'),
          c.vehicle?.registration || '',
          VEHICLE_TYPE_LABELS[c.vehicle?.vehicle_type] || '',
          c.driver?.full_name || '',
          c.mileage != null ? c.mileage.toLocaleString() : '-',
          c.has_defects ? 'YES' : 'No',
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          5: { halign: 'center', fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
            const isYes = data.cell.text[0] === 'YES'
            data.cell.styles.textColor = isYes ? [185, 28, 28] : [21, 128, 61]
          }
        },
        margin: { left: 15, right: 15 },
      })

      drawFooter(doc)
      doc.save(`walk-round-checks-${dateFrom}-to-${dateTo}.pdf`)
      showMessage('PDF downloaded', 'success')
    } catch (e: any) {
      showMessage('PDF error: ' + e.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const exportDefectsPDF = () => {
    setGenerating(true)
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      drawHeader(doc, 'Defects Report')

      const filterLines = [
        `Period: ${new Date(dateFrom).toLocaleDateString('en-GB')} to ${new Date(dateTo).toLocaleDateString('en-GB')}`,
        `Vehicle: ${filterVehicle === 'all' ? 'All vehicles' : vehicles.find(v => v.id === filterVehicle)?.registration || ''}`,
        `Status: ${filterStatus === 'all' ? 'All' : filterStatus}`,
        `Assignee: ${filterAssignee === 'all' ? 'All' : users.find(u => u.id === filterAssignee)?.full_name || ''}`,
        `Total defects: ${defects.length}`,
      ]
      const startY = drawFilters(doc, filterLines)

      autoTable(doc, {
        startY,
        head: [['Reported', 'Vehicle', 'Category', 'Issue', 'Status', 'Assignee', 'Reporter']],
        body: defects.map(d => [
          new Date(d.reported_at).toLocaleDateString('en-GB'),
          d.vehicle?.registration || '',
          d.category || '',
          d.item_text || '',
          d.status,
          d.assignee?.full_name || '-',
          d.reporter?.full_name || '',
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [185, 28, 28], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          4: { halign: 'center', fontStyle: 'bold' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            const status = data.cell.text[0]
            if (status === 'open') data.cell.styles.textColor = [185, 28, 28]
            else if (status === 'fixed') data.cell.styles.textColor = [21, 128, 61]
            else data.cell.styles.textColor = [100, 100, 100]
          }
        },
        margin: { left: 15, right: 15 },
      })

      drawFooter(doc)
      doc.save(`defects-${dateFrom}-to-${dateTo}.pdf`)
      showMessage('PDF downloaded', 'success')
    } catch (e: any) {
      showMessage('PDF error: ' + e.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const exportCSV = (rows: any[][], filename: string) => {
    const escape = (val: any) => {
      const s = val == null ? '' : String(val)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }
    const csv = rows.map(row => row.map(escape).join(',')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    showMessage('CSV downloaded', 'success')
  }

  const exportChecksCSV = () => {
    const rows: any[][] = [
      ['Date', 'Time', 'Registration', 'Fleet Number', 'Vehicle Type', 'Driver', 'Employee Number', 'Mileage', 'Has Defects', 'Driver Signature', 'Driver Notes'],
      ...checks.map(c => [
        new Date(c.check_date + 'T00:00:00').toLocaleDateString('en-GB'),
        new Date(c.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        c.vehicle?.registration || '',
        c.vehicle?.fleet_number || '',
        VEHICLE_TYPE_LABELS[c.vehicle?.vehicle_type] || '',
        c.driver?.full_name || '',
        c.driver?.employee_number || '',
        c.mileage != null ? c.mileage : '',
        c.has_defects ? 'Yes' : 'No',
        c.driver_signature || '',
        c.driver_notes || '',
      ]),
    ]
    exportCSV(rows, `walk-round-checks-${dateFrom}-to-${dateTo}.csv`)
  }

  const exportDefectsCSV = () => {
    const rows: any[][] = [
      ['Reported Date', 'Registration', 'Fleet Number', 'Category', 'Issue', 'Defect Note', 'Status', 'Reporter', 'Assignee', 'Resolved Date', 'Resolver', 'Resolution Notes'],
      ...defects.map(d => [
        new Date(d.reported_at).toLocaleDateString('en-GB'),
        d.vehicle?.registration || '',
        d.vehicle?.fleet_number || '',
        d.category || '',
        d.item_text || '',
        d.defect_note || '',
        d.status,
        d.reporter?.full_name || '',
        d.assignee?.full_name || '',
        d.resolved_at ? new Date(d.resolved_at).toLocaleDateString('en-GB') : '',
        d.resolver?.full_name || '',
        d.resolution_notes || '',
      ]),
    ]
    exportCSV(rows, `defects-${dateFrom}-to-${dateTo}.csv`)
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading reports…</div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">

      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Vehicle Reports</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/vehicles')}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back to Vehicles
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-1.5 flex gap-1">
          <button
            onClick={() => setTab('checks')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === 'checks' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            ✅ Walk-Round Checks
          </button>
          <button
            onClick={() => setTab('defects')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === 'defects' ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            ⚠️ Defects
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Filters</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date from</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date to</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle</label>
              <select
                value={filterVehicle}
                onChange={(e) => setFilterVehicle(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
              >
                <option value="all">All vehicles</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.registration}{v.fleet_number ? ` (#${v.fleet_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {tab === 'checks' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Driver</label>
                  <select
                    value={filterDriver}
                    onChange={(e) => setFilterDriver(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
                  >
                    <option value="all">All drivers</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Defects</label>
                  <select
                    value={filterDefects}
                    onChange={(e) => setFilterDefects(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
                  >
                    <option value="all">All checks</option>
                    <option value="with">With defects only</option>
                    <option value="without">No defects</option>
                  </select>
                </div>
              </>
            )}

            {tab === 'defects' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
                  >
                    <option value="all">All statuses</option>
                    <option value="open">Open</option>
                    <option value="fixed">Fixed</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Assignee</label>
                  <select
                    value={filterAssignee}
                    onChange={(e) => setFilterAssignee(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
                  >
                    <option value="all">All assignees</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap gap-2 items-center justify-between">
          <p className="text-sm text-slate-600 font-medium">
            {tab === 'checks' ? `${checks.length} walk-round checks` : `${defects.length} defects`}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => window.print()}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium"
            >
              🖨️ Print
            </button>
            <button
              onClick={tab === 'checks' ? exportChecksCSV : exportDefectsCSV}
              className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-2 rounded-lg text-sm font-medium"
            >
              📊 CSV
            </button>
            <button
              onClick={tab === 'checks' ? exportChecksPDF : exportDefectsPDF}
              disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {generating ? 'Generating...' : '📄 PDF'}
            </button>
          </div>
        </div>

        {/* Results table */}
        {tab === 'checks' ? (
          checks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
              <p className="text-5xl mb-3">📋</p>
              <p className="text-slate-700 font-medium">No checks match your filters</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-3 font-semibold text-slate-700">Date</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Vehicle</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Driver</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Mileage</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Defects</th>
                    <th className="text-right p-3 font-semibold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c, i) => (
                    <tr key={c.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-3 text-slate-700">
                        {new Date(c.check_date + 'T00:00:00').toLocaleDateString('en-GB')}
                        <p className="text-xs text-slate-400">{new Date(c.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{VEHICLE_TYPE_ICONS[c.vehicle?.vehicle_type] || '🚗'}</span>
                          <div>
                            <p className="font-mono font-bold text-slate-800">{c.vehicle?.registration}</p>
                            {c.vehicle?.fleet_number && <p className="text-xs text-slate-500">#{c.vehicle.fleet_number}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-slate-700">{c.driver?.full_name || '-'}</td>
                      <td className="p-3 text-slate-700 font-mono">
                        {c.mileage != null ? c.mileage.toLocaleString() : '-'}
                      </td>
                      <td className="p-3">
                        {c.has_defects ? (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">⚠️ Yes</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ No</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => router.push(`/dashboard/vehicle-checks/${c.id}`)}
                          className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg font-medium"
                        >
                          View / Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          defects.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
              <p className="text-5xl mb-3">📋</p>
              <p className="text-slate-700 font-medium">No defects match your filters</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-3 font-semibold text-slate-700">Reported</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Vehicle</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Issue</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Status</th>
                    <th className="text-left p-3 font-semibold text-slate-700">Assignee</th>
                    <th className="text-right p-3 font-semibold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {defects.map((d, i) => {
                    const statusColors: Record<string, string> = {
                      open: 'bg-red-100 text-red-700',
                      fixed: 'bg-green-100 text-green-700',
                      dismissed: 'bg-slate-100 text-slate-600',
                    }
                    return (
                      <tr key={d.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="p-3 text-slate-700">
                          {new Date(d.reported_at).toLocaleDateString('en-GB')}
                          <p className="text-xs text-slate-400">by {d.reporter?.full_name || '-'}</p>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{VEHICLE_TYPE_ICONS[d.vehicle?.vehicle_type] || '🚗'}</span>
                            <div>
                              <p className="font-mono font-bold text-slate-800">{d.vehicle?.registration}</p>
                              {d.vehicle?.fleet_number && <p className="text-xs text-slate-500">#{d.vehicle.fleet_number}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-slate-700">
                          <p className="text-xs uppercase text-slate-500">{d.category}</p>
                          <p className="font-medium">{d.item_text}</p>
                        </td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[d.status]}`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-700">{d.assignee?.full_name || '-'}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => router.push(`/dashboard/vehicle-checks/defects/${d.id}`)}
                            className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg font-medium"
                          >
                            View / Print
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

      </div>
    </div>
  )
}
