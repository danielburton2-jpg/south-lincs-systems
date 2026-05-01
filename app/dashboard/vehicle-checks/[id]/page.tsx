'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  class_1: 'Class 1 (HGV Articulated)',
  class_2: 'Class 2 (HGV Rigid)',
  bus: 'Bus',
  coach: 'Coach',
  minibus: 'Minibus',
}

export default function AdminWalkRoundViewPage() {
  const router = useRouter()
  const params = useParams()
  const checkId = params?.id as string

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [check, setCheck] = useState<any>(null)
  const [vehicle, setVehicle] = useState<any>(null)
  const [driver, setDriver] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [photos, setPhotos] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const init = useCallback(async () => {
    if (!checkId) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profile) { router.push('/login'); return }
    setCurrentUser(profile)

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      router.push('/dashboard'); return
    }

    const { data: companyData } = await supabase
      .from('companies').select('*').eq('id', profile.company_id).single()
    setCompany(companyData)

    const { data: checkData, error } = await supabase
      .from('vehicle_checks')
      .select(`
        *,
        vehicle:vehicles (*),
        driver:profiles!vehicle_checks_driver_id_fkey (full_name, employee_number, job_title)
      `)
      .eq('id', checkId)
      .single()

    if (error || !checkData) {
      router.push('/dashboard/vehicle-checks/reports')
      return
    }

    setCheck(checkData)
    setVehicle(checkData.vehicle)
    setDriver(checkData.driver)

    const { data: itemsData } = await supabase
      .from('vehicle_check_items')
      .select('*')
      .eq('check_id', checkId)
      .order('display_order', { ascending: true })

    setItems(itemsData || [])

    // Photos
    const failedItemIds = (itemsData || []).filter(i => i.result === 'fail').map(i => i.id)
    if (failedItemIds.length > 0) {
      const { data: photoData } = await supabase
        .from('vehicle_check_photos')
        .select('*')
        .in('check_item_id', failedItemIds)
      const map: Record<string, any[]> = {}
      ;(photoData || []).forEach((p: any) => {
        if (!map[p.check_item_id]) map[p.check_item_id] = []
        map[p.check_item_id].push(p)
      })
      setPhotos(map)
    }

    setLoading(false)
  }, [router, checkId])

  useEffect(() => { init() }, [init])

  // Group items by category
  const grouped: Record<string, any[]> = {}
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  })
  const categoryOrder = Object.entries(grouped)
    .map(([cat, list]) => ({ cat, firstOrder: list[0]?.display_order || 0 }))
    .sort((a, b) => a.firstOrder - b.firstOrder)
    .map(x => x.cat)

  // Helper: format any item's answer for display (string)
  const formatAnswer = (item: any): string => {
    const t = item.answer_type || 'pass_fail'
    if (t === 'pass_fail') {
      if (item.result === 'pass') return 'PASS'
      if (item.result === 'fail') return 'FAIL'
      if (item.result === 'na') return 'N/A'
      return '-'
    }
    if (t === 'text') return (item.text_answer || '').trim() || '-'
    if (t === 'toggle') {
      if (!item.toggle_answer) return '-'
      return item.toggle_answer.toUpperCase()
    }
    return '-'
  }

  // Helper: classify any item — pass / fail / na / answered
  const classify = (item: any): 'pass' | 'fail' | 'na' | 'answered' | 'unanswered' => {
    const t = item.answer_type || 'pass_fail'
    if (t === 'pass_fail') {
      if (item.result === 'pass') return 'pass'
      if (item.result === 'fail') return 'fail'
      if (item.result === 'na') return 'na'
      return 'unanswered'
    }
    if (t === 'text') {
      return (item.text_answer || '').trim() ? 'answered' : 'unanswered'
    }
    if (t === 'toggle') {
      if (!item.toggle_answer) return 'unanswered'
      if (item.expected_answer && item.toggle_answer !== item.expected_answer) return 'fail'
      return 'pass'
    }
    return 'unanswered'
  }

  const passCount = items.filter(i => classify(i) === 'pass').length
  const failCount = items.filter(i => classify(i) === 'fail').length
  const naCount = items.filter(i => classify(i) === 'na').length
  const answeredCount = items.filter(i => classify(i) === 'answered').length

  const exportPDF = () => {
    if (!check || !vehicle) return
    setGenerating(true)
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()

      // ─── HEADER ───
      doc.setDrawColor(200)
      doc.setFillColor(245, 245, 245)
      doc.rect(15, 12, 30, 18, 'FD')
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text('LOGO', 30, 22, { align: 'center' })

      doc.setFontSize(14)
      doc.setTextColor(40)
      doc.setFont('helvetica', 'bold')
      doc.text(company?.name || '', pageWidth / 2, 18, { align: 'center' })

      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text('Walk-Round Vehicle Check', pageWidth / 2, 25, { align: 'center' })

      doc.setFontSize(8)
      doc.setTextColor(120)
      const generated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      doc.text(`Generated: ${generated}`, pageWidth - 15, 18, { align: 'right' })
      doc.text(`By: ${currentUser?.full_name || ''}`, pageWidth - 15, 23, { align: 'right' })

      doc.setDrawColor(180)
      doc.line(15, 33, pageWidth - 15, 33)

      // ─── VEHICLE & DRIVER DETAILS ───
      let y = 40
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(40)
      doc.text('Vehicle & Check Details', 15, y)
      y += 5

      autoTable(doc, {
        startY: y,
        body: [
          ['Registration', vehicle.registration || '-', 'Vehicle Type', VEHICLE_TYPE_LABELS[vehicle.vehicle_type] || '-'],
          ['Fleet Number', vehicle.fleet_number || '-', 'Make / Model', vehicle.name || '-'],
          ['Driver', driver?.full_name || '-', 'Employee No.', driver?.employee_number || '-'],
          ['Check Date', new Date(check.check_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }), 'Time', new Date(check.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })],
          ['Mileage', check.mileage != null ? check.mileage.toLocaleString() : '-', 'Has Defects', check.has_defects ? 'YES' : 'No'],
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 35 },
          1: { cellWidth: 55 },
          2: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 35 },
          3: { cellWidth: 55 },
        },
        margin: { left: 15, right: 15 },
      })

      y = (doc as any).lastAutoTable.finalY + 6

      // ─── SUMMARY ───
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Summary', 15, y)
      y += 5

      autoTable(doc, {
        startY: y,
        head: [['Pass', 'Fail', 'N/A', 'Total']],
        body: [[
          { content: passCount.toString(), styles: { textColor: [21, 128, 61], fontStyle: 'bold' } },
          { content: failCount.toString(), styles: { textColor: [185, 28, 28], fontStyle: 'bold' } },
          { content: naCount.toString(), styles: { textColor: [100, 100, 100] } },
          items.length.toString(),
        ]],
        styles: { fontSize: 10, cellPadding: 3, halign: 'center' },
        headStyles: { fillColor: [29, 78, 216], textColor: 255, halign: 'center' },
        margin: { left: 15, right: 15 },
      })

      y = (doc as any).lastAutoTable.finalY + 8

      // ─── CHECKLIST ITEMS BY CATEGORY ───
      categoryOrder.forEach(category => {
        const list = grouped[category] || []
        const tableData = list.map(item => {
          const answerType = item.answer_type || 'pass_fail'
          const cls = classify(item)
          let resultCell: any = formatAnswer(item)

          if (answerType === 'pass_fail') {
            if (item.result === 'pass') resultCell = { content: 'PASS', styles: { textColor: [21, 128, 61], fontStyle: 'bold' } }
            else if (item.result === 'fail') resultCell = { content: 'FAIL', styles: { textColor: [185, 28, 28], fontStyle: 'bold' } }
            else if (item.result === 'na') resultCell = { content: 'N/A', styles: { textColor: [100, 100, 100] } }
            else resultCell = '-'
          } else if (answerType === 'toggle') {
            const txt = (item.toggle_answer || '-').toUpperCase()
            if (cls === 'pass') resultCell = { content: txt, styles: { textColor: [21, 128, 61], fontStyle: 'bold' } }
            else if (cls === 'fail') resultCell = { content: txt, styles: { textColor: [185, 28, 28], fontStyle: 'bold' } }
            else resultCell = '-'
          } else if (answerType === 'text') {
            const txt = (item.text_answer || '').trim()
            resultCell = txt
              ? { content: txt, styles: { textColor: [40, 40, 40], fontStyle: 'normal', halign: 'left' } }
              : '-'
          }

          return [item.item_text, resultCell, item.defect_note || '']
        })

        autoTable(doc, {
          startY: y,
          head: [[{ content: category, colSpan: 3, styles: { fillColor: [55, 65, 81], textColor: 255, halign: 'left', fontStyle: 'bold' } }]],
          body: tableData,
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: {
            0: { cellWidth: 80 },
            1: { cellWidth: 43, halign: 'center' },
            2: { cellWidth: 57 },
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 15, right: 15 },
          rowPageBreak: 'avoid',
        })

        y = (doc as any).lastAutoTable.finalY + 4
      })

      // ─── DRIVER NOTES ───
      if (check.driver_notes) {
        if (y > 240) { doc.addPage(); y = 20 }
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text('Driver Notes', 15, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        const lines = doc.splitTextToSize(check.driver_notes, pageWidth - 30)
        doc.text(lines, 15, y)
        y += lines.length * 5 + 4
      }

      // ─── SIGNATURE ───
      if (y > 250) { doc.addPage(); y = 20 }
      y += 4
      doc.setDrawColor(180)
      doc.line(15, y, pageWidth - 15, y)
      y += 6
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Driver Sign-off', 15, y)
      y += 6
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(`Signed: ${check.driver_signature || '-'}`, 15, y)
      doc.setFontSize(9)
      doc.setTextColor(120)
      doc.text(`Submitted ${new Date(check.completed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, pageWidth - 15, y, { align: 'right' })

      // ─── FOOTER (page numbers) ───
      const totalPages = (doc as any).internal.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(140)
        const ph = doc.internal.pageSize.getHeight()
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, ph - 8, { align: 'center' })
        doc.text('South Lincs Systems', 15, ph - 8)
        doc.text(vehicle.registration || '', pageWidth - 15, ph - 8, { align: 'right' })
      }

      doc.save(`walk-round-${vehicle.registration}-${check.check_date}.pdf`)
      showMessage('PDF downloaded', 'success')
    } catch (e: any) {
      showMessage('PDF error: ' + e.message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const openPhoto = async (photo: any) => {
    const { data, error } = await supabase.storage
      .from('vehicle-check-photos')
      .createSignedUrl(photo.storage_path, 60)
    if (error || !data?.signedUrl) { showMessage('Could not open photo', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return (
      <div className="p-8 text-slate-400 italic">Loading check…</div>
    )
  }

  if (!check || !vehicle) return null

  return (
    <div className="p-8 max-w-4xl">

      <div className="mb-6 flex items-baseline justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Walk-Round Check Detail</h1>
          <p className="text-sm text-slate-500">{company?.name}</p>
        </div>
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back
        </button>
      </div>

      <div className="space-y-4">

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium print:hidden ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* Action buttons */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap gap-2 justify-end print:hidden">
          <button
            onClick={() => window.print()}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium"
          >
            🖨️ Print
          </button>
          <button
            onClick={exportPDF}
            disabled={generating}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {generating ? 'Generating...' : '📄 Download PDF'}
          </button>
        </div>

        {/* Print-friendly content */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 print:shadow-none print:border-0 print:p-0">

          {/* Print header */}
          <div className="hidden print:flex items-center justify-between border-b border-slate-300 pb-3 mb-4">
            <div className="bg-slate-100 border border-slate-300 px-4 py-2 text-xs text-slate-500">LOGO</div>
            <div className="text-center">
              <p className="font-bold text-lg">{company?.name}</p>
              <p className="text-sm text-slate-600">Walk-Round Vehicle Check</p>
            </div>
            <div className="text-xs text-slate-600 text-right">
              <p>Generated: {new Date().toLocaleDateString('en-GB')}</p>
              <p>By: {currentUser?.full_name}</p>
            </div>
          </div>

          {/* Vehicle & driver details */}
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Vehicle & Check Details</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Registration</p>
              <p className="font-mono font-bold text-lg">{vehicle.registration}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Vehicle Type</p>
              <p className="font-medium">{VEHICLE_TYPE_LABELS[vehicle.vehicle_type]}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Fleet Number</p>
              <p className="font-medium">{vehicle.fleet_number || '-'}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Make / Model</p>
              <p className="font-medium">{vehicle.name || '-'}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Driver</p>
              <p className="font-medium">{driver?.full_name || '-'}</p>
              {driver?.employee_number && <p className="text-xs text-slate-500">Emp #{driver.employee_number}</p>}
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Check Date</p>
              <p className="font-medium">
                {new Date(check.check_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
              <p className="text-xs text-slate-500">{new Date(check.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Mileage</p>
              <p className="font-mono font-bold text-lg">{check.mileage != null ? check.mileage.toLocaleString() : '-'}</p>
            </div>
            <div className={`p-3 rounded-lg ${check.has_defects ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className="text-xs text-slate-500 uppercase">Has Defects</p>
              <p className={`font-bold text-lg ${check.has_defects ? 'text-red-700' : 'text-green-700'}`}>
                {check.has_defects ? '⚠️ YES' : '✓ No'}
              </p>
            </div>
          </div>

          {/* Summary */}
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Summary</h2>
          <div className="grid grid-cols-4 gap-2 mb-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{passCount}</p>
              <p className="text-xs text-green-600 font-medium">Pass</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{failCount}</p>
              <p className="text-xs text-red-600 font-medium">Fail</p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-slate-700">{naCount}</p>
              <p className="text-xs text-slate-600 font-medium">N/A</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{items.length}</p>
              <p className="text-xs text-blue-600 font-medium">Total</p>
            </div>
          </div>

          {/* Checklist items by category */}
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Checklist Results</h2>
          <div className="space-y-3 mb-6">
            {categoryOrder.map(category => {
              const list = grouped[category] || []
              return (
                <div key={category} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-700 text-white px-3 py-2">
                    <h3 className="font-semibold text-sm uppercase tracking-wide">{category}</h3>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.map((item, i) => {
                        const itemPhotos = photos[item.id] || []
                        const answerType = item.answer_type || 'pass_fail'
                        const cls = classify(item)
                        return (
                          <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="p-2 border-t border-slate-100 align-top">
                              {item.item_text}
                              {answerType === 'text' && (
                                <span className="ml-2 text-[10px] uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Text</span>
                              )}
                              {answerType === 'toggle' && (
                                <span className="ml-2 text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                  Yes/No{item.expected_answer ? ` (expects ${item.expected_answer.toUpperCase()})` : ''}
                                </span>
                              )}
                            </td>
                            <td className="p-2 border-t border-slate-100 text-center w-32 align-top">
                              {answerType === 'pass_fail' && (
                                <>
                                  {item.result === 'pass' && <span className="text-green-700 font-bold">PASS</span>}
                                  {item.result === 'fail' && <span className="text-red-700 font-bold">FAIL</span>}
                                  {item.result === 'na' && <span className="text-slate-500">N/A</span>}
                                  {!item.result && <span className="text-slate-400">-</span>}
                                </>
                              )}
                              {answerType === 'toggle' && (
                                <>
                                  {item.toggle_answer ? (
                                    <span className={`font-bold uppercase ${
                                      cls === 'pass' ? 'text-green-700' : cls === 'fail' ? 'text-red-700' : 'text-slate-700'
                                    }`}>
                                      {item.toggle_answer}
                                      {cls === 'fail' && <span className="block text-[10px] font-normal text-red-600">⚠ Defect</span>}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </>
                              )}
                              {answerType === 'text' && (
                                <p className="text-left text-sm text-slate-800 whitespace-pre-wrap break-words">
                                  {(item.text_answer || '').trim() || <span className="text-slate-400">-</span>}
                                </p>
                              )}
                            </td>
                            <td className="p-2 border-t border-slate-100 w-1/3 align-top">
                              {item.defect_note && (
                                <p className="text-xs text-red-700 italic whitespace-pre-wrap">{item.defect_note}</p>
                              )}
                              {itemPhotos.length > 0 && (
                                <div className="flex gap-1 mt-1 print:hidden">
                                  {itemPhotos.map(p => (
                                    <button
                                      key={p.id}
                                      onClick={() => openPhoto(p)}
                                      className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-0.5 rounded"
                                    >
                                      📷 View
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>

          {/* Driver notes */}
          {check.driver_notes && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Driver Notes</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{check.driver_notes}</p>
              </div>
            </div>
          )}

          {/* Sign-off */}
          <div className="border-t border-slate-300 pt-4">
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Driver Sign-off</h2>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-slate-500 uppercase">Signed</p>
                <p className="text-lg font-medium">{check.driver_signature || '-'}</p>
              </div>
              <p className="text-xs text-slate-500">
                Submitted {new Date(check.completed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 1.5cm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  )
}
