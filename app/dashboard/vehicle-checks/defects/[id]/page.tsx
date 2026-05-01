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

export default function AdminDefectViewPage() {
  const router = useRouter()
  const params = useParams()
  const defectId = params?.id as string

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [defect, setDefect] = useState<any>(null)
  const [vehicle, setVehicle] = useState<any>(null)
  const [photos, setPhotos] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
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
    if (!defectId) return

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

    const { data: defectData, error } = await supabase
      .from('vehicle_defects')
      .select(`
        *,
        vehicle:vehicles (*),
        reporter:profiles!vehicle_defects_reported_by_fkey (full_name, employee_number),
        resolver:profiles!vehicle_defects_resolved_by_fkey (full_name),
        assignee:profiles!vehicle_defects_assigned_to_fkey (full_name, job_title),
        assigner:profiles!vehicle_defects_assigned_by_fkey (full_name)
      `)
      .eq('id', defectId)
      .single()

    if (error || !defectData) {
      router.push('/dashboard/vehicle-checks/reports')
      return
    }

    setDefect(defectData)
    setVehicle(defectData.vehicle)

    if (defectData.check_item_id) {
      const { data: photoData } = await supabase
        .from('vehicle_check_photos')
        .select('*')
        .eq('check_item_id', defectData.check_item_id)
      setPhotos(photoData || [])
    }

    const { data: notesData } = await supabase
      .from('vehicle_defect_notes')
      .select('*, author:profiles(full_name)')
      .eq('defect_id', defectId)
      .order('created_at', { ascending: true })
    setNotes(notesData || [])

    setLoading(false)
  }, [router, defectId])

  useEffect(() => { init() }, [init])

  const exportPDF = () => {
    if (!defect || !vehicle) return
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
      doc.text('Vehicle Defect Report', pageWidth / 2, 25, { align: 'center' })

      doc.setFontSize(8)
      doc.setTextColor(120)
      const generated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      doc.text(`Generated: ${generated}`, pageWidth - 15, 18, { align: 'right' })
      doc.text(`By: ${currentUser?.full_name || ''}`, pageWidth - 15, 23, { align: 'right' })

      doc.setDrawColor(180)
      doc.line(15, 33, pageWidth - 15, 33)

      // ─── STATUS BANNER ───
      let y = 38
      const statusColors: Record<string, [number, number, number]> = {
        open: [254, 226, 226],
        fixed: [220, 252, 231],
        dismissed: [243, 244, 246],
      }
      const statusTextColors: Record<string, [number, number, number]> = {
        open: [185, 28, 28],
        fixed: [21, 128, 61],
        dismissed: [107, 114, 128],
      }
      const c = statusColors[defect.status] || [243, 244, 246]
      doc.setFillColor(c[0], c[1], c[2])
      doc.rect(15, y, pageWidth - 30, 8, 'F')
      const tc = statusTextColors[defect.status] || [40, 40, 40]
      doc.setTextColor(tc[0], tc[1], tc[2])
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`STATUS: ${defect.status.toUpperCase()}`, pageWidth / 2, y + 5.5, { align: 'center' })
      y += 12

      // ─── VEHICLE & DEFECT DETAILS ───
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(40)
      doc.text('Vehicle & Defect Details', 15, y)
      y += 5

      autoTable(doc, {
        startY: y,
        body: [
          ['Registration', vehicle.registration || '-', 'Vehicle Type', VEHICLE_TYPE_LABELS[vehicle.vehicle_type] || '-'],
          ['Fleet Number', vehicle.fleet_number || '-', 'Make / Model', vehicle.name || '-'],
          ['Category', defect.category || '-', 'Reported', new Date(defect.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
          ['Reported by', defect.reporter?.full_name || '-', 'Employee No.', defect.reporter?.employee_number || '-'],
          ['Assigned to', defect.assignee?.full_name || 'Not assigned', 'Job title', defect.assignee?.job_title || '-'],
          ['Assigned by', defect.assigner?.full_name || '-', 'Assigned at', defect.assigned_at ? new Date(defect.assigned_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'],
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

      // ─── DEFECT DESCRIPTION ───
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(40)
      doc.text('Defect Description', 15, y)
      y += 5

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setFillColor(254, 242, 242)
      doc.setDrawColor(252, 165, 165)
      doc.rect(15, y, pageWidth - 30, 8, 'FD')
      doc.setTextColor(127, 29, 29)
      doc.setFont('helvetica', 'bold')
      doc.text(defect.item_text || '-', 18, y + 5.5)
      y += 11

      if (defect.defect_note) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(60)
        const lines = doc.splitTextToSize(defect.defect_note, pageWidth - 36)
        doc.setFillColor(254, 252, 232)
        doc.setDrawColor(254, 240, 138)
        doc.rect(15, y, pageWidth - 30, lines.length * 5 + 4, 'FD')
        doc.text(lines, 18, y + 5)
        y += lines.length * 5 + 8
      }

      // ─── REPAIR LOG / NOTES ───
      if (notes.length > 0) {
        if (y > 240) { doc.addPage(); y = 20 }
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(40)
        doc.text(`Repair Log (${notes.length})`, 15, y)
        y += 5

        autoTable(doc, {
          startY: y,
          head: [['Date', 'Author', 'Note']],
          body: notes.map(n => [
            new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            n.author?.full_name || '-',
            n.note,
          ]),
          styles: { fontSize: 8, cellPadding: 2, valign: 'top' },
          headStyles: { fillColor: [217, 119, 6], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [254, 252, 232] },
          columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 40 },
            2: { cellWidth: 110 },
          },
          margin: { left: 15, right: 15 },
        })
        y = (doc as any).lastAutoTable.finalY + 6
      }

      // ─── PHOTOS ───
      if (photos.length > 0) {
        if (y > 250) { doc.addPage(); y = 20 }
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(40)
        doc.text(`Photos Attached (${photos.length})`, 15, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(80)
        photos.forEach((p, i) => {
          doc.text(`${i + 1}. ${p.file_name}`, 18, y)
          y += 4
        })
        doc.setFontSize(8)
        doc.setTextColor(140)
        doc.text('(Photos available in app — not embedded in this PDF)', 18, y + 1)
        y += 6
      }

      // ─── RESOLUTION ───
      if (defect.resolved_at) {
        if (y > 240) { doc.addPage(); y = 20 }
        y += 4
        doc.setDrawColor(180)
        doc.line(15, y, pageWidth - 15, y)
        y += 6
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(40)
        doc.text(`${defect.status === 'fixed' ? 'Resolution' : 'Dismissal'}`, 15, y)
        y += 5

        autoTable(doc, {
          startY: y,
          body: [
            [defect.status === 'fixed' ? 'Fixed by' : 'Dismissed by', defect.resolver?.full_name || '-'],
            ['Date', new Date(defect.resolved_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
          ],
          theme: 'grid',
          styles: { fontSize: 9, cellPadding: 2 },
          columnStyles: {
            0: { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 35 },
          },
          margin: { left: 15, right: 15 },
        })
        y = (doc as any).lastAutoTable.finalY + 4

        if (defect.resolution_notes) {
          doc.setFontSize(9)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(60)
          const lines = doc.splitTextToSize(defect.resolution_notes, pageWidth - 36)
          doc.setFillColor(220, 252, 231)
          doc.setDrawColor(134, 239, 172)
          doc.rect(15, y, pageWidth - 30, lines.length * 5 + 4, 'FD')
          doc.text(lines, 18, y + 5)
          y += lines.length * 5 + 8
        }
      }

      // ─── FOOTER ───
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

      doc.save(`defect-${vehicle.registration}-${new Date(defect.reported_at).toISOString().slice(0,10)}.pdf`)
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
      <div className="p-8 text-slate-400 italic">Loading defect…</div>
    )
  }

  if (!defect || !vehicle) return null

  const statusColors: Record<string, string> = {
    open: 'bg-red-100 text-red-700 border-red-300',
    fixed: 'bg-green-100 text-green-700 border-green-300',
    dismissed: 'bg-slate-100 text-slate-600 border-slate-300',
  }

  return (
    <div className="p-8 max-w-4xl">

      <div className="mb-6 flex items-baseline justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Defect Detail</h1>
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

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 print:shadow-none print:p-0">

          <div className="hidden print:flex items-center justify-between border-b border-slate-300 pb-3 mb-4">
            <div className="bg-slate-100 border border-slate-300 px-4 py-2 text-xs text-slate-500">LOGO</div>
            <div className="text-center">
              <p className="font-bold text-lg">{company?.name}</p>
              <p className="text-sm text-slate-600">Vehicle Defect Report</p>
            </div>
            <div className="text-xs text-slate-600 text-right">
              <p>Generated: {new Date().toLocaleDateString('en-GB')}</p>
              <p>By: {currentUser?.full_name}</p>
            </div>
          </div>

          {/* Status banner */}
          <div className={`border-2 rounded-lg p-4 text-center mb-6 ${statusColors[defect.status]}`}>
            <p className="text-xs uppercase tracking-wide font-medium">Status</p>
            <p className="text-2xl font-bold uppercase">{defect.status}</p>
          </div>

          <h2 className="text-lg font-semibold text-slate-800 mb-3">Vehicle & Defect Details</h2>
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
              <p className="text-xs text-slate-500 uppercase">Category</p>
              <p className="font-medium">{defect.category}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Reported</p>
              <p className="font-medium">
                {new Date(defect.reported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              <p className="text-xs text-slate-500">{new Date(defect.reported_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-lg">
              <p className="text-xs text-slate-500 uppercase">Reported by</p>
              <p className="font-medium">{defect.reporter?.full_name || '-'}</p>
              {defect.reporter?.employee_number && <p className="text-xs text-slate-500">Emp #{defect.reporter.employee_number}</p>}
            </div>
            <div className={`p-3 rounded-lg ${defect.assignee ? 'bg-purple-50' : 'bg-slate-50'}`}>
              <p className="text-xs text-slate-500 uppercase">Assigned to</p>
              <p className="font-medium">{defect.assignee?.full_name || 'Not assigned'}</p>
              {defect.assignee?.job_title && <p className="text-xs text-slate-500">{defect.assignee.job_title}</p>}
            </div>
          </div>

          <h2 className="text-lg font-semibold text-slate-800 mb-3">Defect Description</h2>
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 mb-3">
            <p className="font-bold text-red-900">{defect.item_text}</p>
          </div>
          {defect.defect_note && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
              <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Detailed notes</p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{defect.defect_note}</p>
            </div>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <div className="mb-6 print:hidden">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">Photos ({photos.length})</h2>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(p => (
                  <button
                    key={p.id}
                    onClick={() => openPhoto(p)}
                    className="bg-slate-100 hover:bg-slate-200 rounded-lg p-3 text-center transition"
                  >
                    <span className="text-3xl">📷</span>
                    <p className="text-xs text-slate-600 truncate mt-1">{p.file_name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Repair log */}
          {notes.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">🔧 Repair Log ({notes.length})</h2>
              <div className="space-y-2">
                {notes.map(n => (
                  <div key={n.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.note}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {n.author?.full_name || '-'} · {new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resolution */}
          {defect.resolved_at && (
            <div className="border-t border-slate-300 pt-4">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">
                {defect.status === 'fixed' ? '✓ Resolution' : '✗ Dismissal'}
              </h2>
              <div className={`border rounded-lg p-3 ${
                defect.status === 'fixed' ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs text-slate-500 uppercase">{defect.status === 'fixed' ? 'Fixed by' : 'Dismissed by'}</p>
                    <p className="font-medium">{defect.resolver?.full_name || '-'}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(defect.resolved_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {defect.resolution_notes && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <p className="text-xs text-slate-500 uppercase">Resolution notes</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap mt-1">{defect.resolution_notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 1.5cm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  )
}
