'use client'
/**
 * /employee/documents
 *
 * Read-only documents view for drivers. Same data as /dashboard/documents
 * but no upload, no folder create/delete, no file delete. Mobile-first
 * with the standard employee gradient header.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Folder = {
  id: string
  name: string
  file_count: number
  created_at: string
}

type Document = {
  id: string
  folder_id: string | null
  filename: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_at: string
  uploaded_by_name: string
  signed_url: string | null
}

export default function EmployeeDocuments() {
  const router = useRouter()
  const [me, setMe] = useState<{ id: string } | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [rootCount, setRootCount] = useState(0)
  const [docs, setDocs] = useState<Document[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null | 'root'>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login')
      else setMe({ id: user.id })
    })
  }, [router])

  const loadFolders = useCallback(async () => {
    const res = await fetch('/api/documents/folders')
    const data = await res.json()
    if (res.ok) {
      setFolders(data.folders || [])
      setRootCount(data.root_count || 0)
    }
  }, [])

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true)
    try {
      let url = '/api/documents'
      if (selectedFolder === 'root') url += '?root=true'
      else if (selectedFolder) url += `?folder_id=${selectedFolder}`
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok) setDocs(data.documents || [])
    } finally {
      setLoadingDocs(false)
    }
  }, [selectedFolder])

  useEffect(() => { if (me) loadFolders() }, [me, loadFolders])
  useEffect(() => { if (me) loadDocs() }, [me, loadDocs])

  // Realtime auto-refresh
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel('employee-documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' },
        () => { loadFolders(); loadDocs() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_folders' },
        () => loadFolders())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [me, loadFolders, loadDocs])

  const selectedFolderName = useMemo(() => {
    if (selectedFolder === null) return 'All files'
    if (selectedFolder === 'root') return 'Unfiled'
    const f = folders.find(x => x.id === selectedFolder)
    return f?.name || 'Folder'
  }, [selectedFolder, folders])

  if (!me) return <div className="p-8 text-slate-400 italic">Loading…</div>

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-4">
        <button
          onClick={() => router.push('/employee')}
          className="text-xs text-indigo-100 hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold mt-2">📁 Documents</h1>
      </div>

      <div className="px-4 py-4">
        {/* Folders */}
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Folders</h2>
        <div className="grid grid-cols-2 gap-2 mb-5">
          <FolderTile
            icon="📂"
            name="All files"
            count={folders.reduce((s, f) => s + f.file_count, 0) + rootCount}
            active={selectedFolder === null}
            onClick={() => setSelectedFolder(null)}
          />
          <FolderTile
            icon="📄"
            name="Unfiled"
            count={rootCount}
            active={selectedFolder === 'root'}
            onClick={() => setSelectedFolder('root')}
          />
          {folders.map(f => (
            <FolderTile
              key={f.id}
              icon="📁"
              name={f.name}
              count={f.file_count}
              active={selectedFolder === f.id}
              onClick={() => setSelectedFolder(f.id)}
            />
          ))}
        </div>

        {/* Files */}
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          {selectedFolderName} ({docs.length})
        </h2>
        {loadingDocs ? (
          <p className="text-slate-400 italic text-sm py-6">Loading files…</p>
        ) : docs.length === 0 ? (
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm text-slate-700 font-medium">No files yet</p>
          </div>
        ) : (
          <ul className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {docs.map(d => (
              <FileRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FolderTile({
  icon, name, count, active, onClick,
}: {
  icon: string
  name: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-3 rounded-xl border transition ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl flex-shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{name}</p>
          <p className={`text-xs ${active ? 'text-indigo-200' : 'text-slate-500'}`}>
            {count} {count === 1 ? 'file' : 'files'}
          </p>
        </div>
      </div>
    </button>
  )
}

function FileRow({ doc }: { doc: Document }) {
  const icon = mimeIcon(doc.mime_type)
  const isImage = doc.mime_type?.startsWith('image/')

  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 font-medium truncate">{doc.filename}</p>
        <p className="text-xs text-slate-500 truncate">
          {formatBytes(doc.size_bytes)} · {formatDate(doc.uploaded_at)}
        </p>
      </div>
      {doc.signed_url && (
        <a
          href={doc.signed_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg flex-shrink-0"
        >
          {isImage ? 'View' : 'Download'}
        </a>
      )}
    </li>
  )
}

function mimeIcon(mime: string | null): string {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼'
  if (mime === 'application/pdf') return '📕'
  if (mime.includes('word')) return '📘'
  if (mime.includes('excel') || mime.includes('spreadsheet') || mime === 'text/csv') return '📗'
  if (mime.startsWith('text/')) return '📝'
  return '📄'
}

function formatBytes(n: number | null): string {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
