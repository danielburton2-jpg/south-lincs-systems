'use client'

import { useRef } from 'react'

/**
 * Day-sheet documents BUFFER panel — used on the new-day-sheet
 * form where the day sheet doesn't yet exist, so we can't attach
 * uploaded documents to anything.
 *
 * Files are staged in the parent's state. The actual upload + attach
 * runs in the parent's submit handler AFTER the day sheet is
 * created.
 *
 * Use the live `<DaySheetDocumentsPanel>` on the edit page where
 * the sheet exists and uploads can run immediately.
 *
 * Identical file-type / size constraints to the live panel and the
 * Documents page (50 MB, pdf/doc/xls/csv/txt/image).
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

type Props = {
  files: File[]
  onChange: (files: File[]) => void
  isAdmin: boolean
  disabled?: boolean
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const mimeIcon = (mime: string): string => {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word')) return '📘'
  if (mime.includes('excel') || mime.includes('spreadsheet') || mime === 'text/csv') return '📊'
  return '📄'
}

export default function DaySheetDocumentsBuffer({
  files,
  onChange,
  isAdmin,
  disabled = false,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files
    if (!picked || picked.length === 0) return

    const next: File[] = [...files]
    const errors: string[] = []
    for (const f of Array.from(picked)) {
      const ok = ALLOWED_MIME_PREFIXES.some(p => f.type.startsWith(p))
      if (!ok) {
        errors.push(`Skipped ${f.name} — unsupported file type`)
        continue
      }
      if (f.size > MAX_BYTES) {
        errors.push(`${f.name} is too large (max 50 MB)`)
        continue
      }
      // De-dupe on (name, size, lastModified) — close enough for a
      // staging buffer; identical file picked twice gets ignored.
      const dupe = next.some(
        x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified
      )
      if (dupe) continue
      next.push(f)
    }
    onChange(next)

    if (errors.length > 0) {
      // Surface as alert — keeping the buffer panel small. The
      // parent form's own error area handles real submit errors.
      alert(errors.join('\n'))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const remove = (index: number) => {
    const next = files.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick any files to attach (route maps, risk assessments, customer paperwork). They&apos;ll upload and attach when you click Create.
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
              onChange={addFiles}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                disabled
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              + Pick files
            </button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <p className="text-xs text-amber-700 italic">
          Only admins can attach documents. Saved sheets can have documents attached on the edit page.
        </p>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No files staged yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${f.lastModified}`}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg" aria-hidden>{mimeIcon(f.type)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {formatSize(f.size)} · ready to upload
                  </p>
                </div>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
