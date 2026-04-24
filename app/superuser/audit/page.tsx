'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useIdleLogout, IdleWarningModal } from '@/lib/useIdleLogout'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const supabase = createClient()

const ACTION_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: 'bg-green-100 text-green-700',
  LOGIN_FAILED: 'bg-red-100 text-red-700',
  LOGIN_BLOCKED_FROZEN: 'bg-orange-100 text-orange-700',
  LOGOUT: 'bg-gray-100 text-gray-700',
  LOGOUT_IDLE: 'bg-gray-100 text-gray-700',
  CREATE_USER: 'bg-blue-100 text-blue-700',
  CREATE_USER_FAILED: 'bg-red-100 text-red-700',
  CREATE_COMPANY: 'bg-purple-100 text-purple-700',
  EDIT_COMPANY: 'bg-purple-100 text-purple-700',
  FREEZE_USER: 'bg-orange-100 text-orange-700',
  UNFREEZE_USER: 'bg-green-100 text-green-700',
  REMOVE_USER: 'bg-red-100 text-red-700',
  EDIT_USER: 'bg-yellow-100 text-yellow-700',
  EDIT_COMPANY_USER: 'bg-yellow-100 text-yellow-700',
  FREEZE_COMPANY_USER: 'bg-orange-100 text-orange-700',
  UNFREEZE_COMPANY_USER: 'bg-green-100 text-green-700',
  REMOVE_COMPANY_USER: 'bg-red-100 text-red-700',
  ACTIVATE_COMPANY: 'bg-green-100 text-green-700',
  DEACTIVATE_COMPANY: 'bg-orange-100 text-orange-700',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const router = useRouter()
  const { showWarning, secondsLeft, stayLoggedIn } = useIdleLogout(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setLogs(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const filteredLogs = logs.filter((log) => {
    if (!filter) return true
    return (
      log.action?.toLowerCase().includes(filter.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(filter.toLowerCase()) ||
      log.entity?.toLowerCase().includes(filter.toLowerCase())
    )
  })

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getExportRows = () => {
    return filteredLogs.map((log) => ({
      'Date & Time': formatDate(log.created_at),
      'Action': log.action || '—',
      'User': log.user_email || '—',
      'Role': log.user_role || '—',
      'Entity': log.entity || '—',
      'Details': log.details ? JSON.stringify(log.details) : '—',
      'IP Address': log.ip_address || '—',
    }))
  }

  const handleExportExcel = () => {
    const rows = getExportRows()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Log')

    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key as keyof typeof r] || '').length))
    }))
    worksheet['!cols'] = colWidths

    XLSX.writeFile(workbook, `audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' })

    doc.setFontSize(16)
    doc.text('South Lincs Systems — Audit Log', 14, 15)
    doc.setFontSize(10)
    doc.text(`Exported: ${formatDate(new Date().toISOString())}`, 14, 22)

    autoTable(doc, {
      startY: 28,
      head: [['Date & Time', 'Action', 'User', 'Role', 'Entity', 'Details']],
      body: filteredLogs.map((log) => [
        formatDate(log.created_at),
        log.action || '—',
        log.user_email || '—',
        log.user_role || '—',
        log.entity || '—',
        log.details ? JSON.stringify(log.details) : '—',
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [29, 78, 216], textColor: 255 },
      alternateRowStyles: { fillColor: [243, 244, 246] },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 40 },
        2: { cellWidth: 50 },
        3: { cellWidth: 25 },
        4: { cellWidth: 20 },
        5: { cellWidth: 'auto' },
      },
    })

    doc.save(`audit-log-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  const handlePrint = () => {
    const rows = filteredLogs.map((log) => `
      <tr>
        <td>${formatDate(log.created_at)}</td>
        <td>${log.action || '—'}</td>
        <td>${log.user_email || '—'}</td>
        <td>${log.user_role || '—'}</td>
        <td>${log.entity || '—'}</td>
        <td>${log.details ? JSON.stringify(log.details) : '—'}</td>
      </tr>
    `).join('')

    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <head>
          <title>South Lincs Systems — Audit Log</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; }
            h1 { font-size: 16px; margin-bottom: 4px; }
            p { font-size: 11px; color: #666; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #1d4ed8; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
            td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 10px; }
            tr:nth-child(even) { background: #f9fafb; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>South Lincs Systems — Audit Log</h1>
          <p>Exported: ${formatDate(new Date().toISOString())} | Total records: ${filteredLogs.length}</p>
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Action</th>
                <th>User</th>
                <th>Role</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <IdleWarningModal show={showWarning} secondsLeft={secondsLeft} onStay={stayLoggedIn} />

      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">South Lincs Systems</h1>
        <button
          onClick={() => router.push('/superuser')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">

        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Audit Log</h2>
          <div className="flex gap-2">
            <button
              onClick={fetchLogs}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition text-sm"
            >
              Refresh
            </button>
            <button
              onClick={handleExportExcel}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition text-sm"
            >
              Export Excel
            </button>
            <button
              onClick={handleExportPDF}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition text-sm"
            >
              Export PDF
            </button>
            <button
              onClick={handlePrint}
              className="bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition text-sm"
            >
              Print
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action, email or entity..."
            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading audit logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No audit logs found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Date & Time</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Action</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Entity</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{log.user_email || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{log.user_role || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{log.entity || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-gray-400 text-sm">
          Showing {filteredLogs.length} of {logs.length} records
        </p>

      </div>
    </main>
  )
}