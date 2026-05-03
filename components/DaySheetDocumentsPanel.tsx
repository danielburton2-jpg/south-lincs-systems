'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Day-sheet documents panel.
 *
 * Drops in on the day-sheet edit page (and the new page after the
 * sheet has been created). Lists already-attached documents with
 * remove + open buttons, and provides an upload button that:
 *   1. asks the existing /api/documents/upload-url for a signed
 *      upload URL (admin-gated),
 *   2. PUTs the file directly to Supabase Storage,
 *   3. calls /api/documents/finalize to record metadata,
 *   4. calls /api/attach-day-sheet-document to link to this sheet.
 *
 * Same upload constraints as the main Documents page (50 MB,
 * pdf/doc/xls/csv/txt/image).
 *
 * Admin-only — non-admin viewers can still see the list (read-only)
 * but the Upload button is hidden.
 */

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]
const ALLOWED_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*'
const MAX_BYTES = 50 * 1024 * 1024

type DocumentRow = {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_at: string | null
  uploaded_by_name: string | null
  signed_url: string | null
}

type Props = {
  daySheetId: string                  // required — panel only renders when sheet exists
  isAdmin: boolean                    // controls upload + remove visibility
}

const formatSize = (bytes: number | null) => {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const mimeIcon = (mime: string | null): string => {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word')) return '📘'
  if (mime.includes('excel') || mime.includes('spreadsheet') || mime === 'text/csv') return '📊'
  return '📄'
}

export default function DaySheetDocumentsPanel({ daySheetId, isAdmin }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/list-day-sheet-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day_sheet_id: daySheetId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load documents')
        setLoading(false)
        return
      }
      setDocs(data.documents || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [daySheetId])

  useEffect(() => { load() }, [load])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setBusy(true)
    setError('')

    try {
      for (const file of Array.from(files)) {
        const ok = ALLOWED_MIME_PREFIXES.some(p => file.type.startsWith(p))
        if (!ok) {
          setError(`Skipped ${file.name} — unsupported file type`)
          continue
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is too large (max 50 MB)`)
          continue
        }

        const documentId = crypto.randomUUID()
        setProgress(`Uploading ${file.name}…`)

        // 1. Get signed upload URL (folder_id=null → root of Documents)
        const signRes = await fetch('/api/documents/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            folder_id: null,
            filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          }),
        })
        const signData = await signRes.json()
        if (!signRes.ok) {
          setError(signData.error || `Failed to start upload for ${file.name}`)
          continue
        }

        // 2. PUT file to Supabase Storage
        const putRes = await fetch(signData.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!putRes.ok) {
          setError(`Upload failed for ${file.name} (${putRes.status})`)
          continue
        }

        // 3. Finalize — records the documents row
        const finRes = await fetch('/api/documents/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            folder_id: null,
            storage_path: signData.storage_path,
            filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          }),
        })
        const finData = await finRes.json()
        if (!finRes.ok) {
          setError(finData.error || `Failed to finalize ${file.name}`)
          continue
        }

        // 4. Attach to this day sheet
        const attRes = await fetch('/api/attach-day-sheet-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day_sheet_id: daySheetId,
            document_id: documentId,
          }),
        })
        const attData = await attRes.json()
        if (!attRes.ok) {
          setError(attData.error || `Failed to attach ${file.name}`)
          continue
        }
      }
      setProgress('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDetach = async (documentId: string, filename: string) => {
    if (!isAdmin) return
    if (!confirm(`Remove "${filename}" from this day sheet? The document itself stays in the Documents library.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/detach-day-sheet-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_sheet_id: daySheetId,
          document_id: documentId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to detach')
        return
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to detach')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Attach files relevant to this day sheet (route maps, risk assessments, customer paperwork).
          </p>
        </div>
        {isAdmin && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_ACCEPT}
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                busy
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {busy ? 'Working…' : '+ Upload document'}
            </button>
          </div>
        )}
      </div>

      {progress && (
        <div className="mb-2 text-xs text-slate-600">{progress}</div>
      )}
      {error && (
        <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 italic">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No documents attached yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {docs.map(d => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg" aria-hidden>{mimeIcon(d.mime_type)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{d.filename}</p>
                  <p className="text-[11px] text-slate-500">
                    {formatSize(d.size_bytes)}
                    {d.uploaded_by_name ? ` · uploaded by ${d.uploaded_by_name}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.signed_url ? (
                  <a
                    href={d.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">unavailable</span>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDetach(d.id, d.filename)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
