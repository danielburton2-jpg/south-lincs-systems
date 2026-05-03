'use client'
/**
 * /dashboard/documents
 *
 * Admin/manager view of the company documents folder.
 *
 * Layout (one pane):
 *   • Folder list at top (with file counts) + "Root" pseudo-folder for unfiled
 *   • File list at the bottom — files in the currently-selected folder, or all
 *     if no folder selected
 *   • Admin-only: "+ New folder" button, "Upload" button on each folder/root
 *
 * Managers see the same UI but admin-only buttons are hidden. The
 * server-side endpoints also reject non-admin write operations even
 * if a manager's client somehow sends a request.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export default function DashboardDocuments() {
  const router = useRouter()
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [rootCount, setRootCount] = useState(0)
  const [docs, setDocs] = useState<Document[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null | 'root'>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Auth + role check
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (!profile) { router.push('/login'); return }
      setMe({ id: user.id, role: profile.role })
    })
  }, [router])

  const isAdmin = me?.role === 'admin'

  // ── Load folders ──
  const loadFolders = useCallback(async () => {
    const res = await fetch('/api/documents/folders')
    const data = await res.json()
    if (res.ok) {
      setFolders(data.folders || [])
      setRootCount(data.root_count || 0)
    }
  }, [])

  // ── Load docs (all, or for selected folder) ──
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

  useEffect(() => {
    if (me) loadFolders()
  }, [me, loadFolders])

  useEffect(() => {
    if (me) loadDocs()
  }, [me, loadDocs])

  // ── Realtime — auto-refresh on folder/doc changes ──
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel('documents-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_folders' },
        () => loadFolders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' },
        () => { loadFolders(); loadDocs() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [me, loadFolders, loadDocs])

  // ── Create folder ──
  const handleCreateFolder = async () => {
    setError('')
    const name = newFolderName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch('/api/documents/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create folder')
        return
      }
      setNewFolderName('')
      setShowNewFolder(false)
      loadFolders()
    } finally {
      setBusy(false)
    }
  }

  // ── Delete folder ──
  const handleDeleteFolder = async (folder: Folder) => {
    if (!confirm(`Delete folder "${folder.name}"?`)) return
    setError('')
    const res = await fetch(`/api/documents/folders/${folder.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Could not delete')
      return
    }
    if (selectedFolder === folder.id) setSelectedFolder(null)
    loadFolders()
  }

  // ── Upload files ──
  const onFilesPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError('')
    setBusy(true)
    try {
      const targetFolder: string | null =
        (selectedFolder === 'root' || selectedFolder === null) ? null : selectedFolder

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`)

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

        // 1. Get signed URL
        const signRes = await fetch('/api/documents/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            folder_id: targetFolder,
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

        // 2. PUT file
        const putRes = await fetch(signData.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!putRes.ok) {
          setError(`Upload failed for ${file.name} (${putRes.status})`)
          continue
        }

        // 3. Finalize
        const finRes = await fetch('/api/documents/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            folder_id: targetFolder,
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
      }

      setProgress('')
      loadFolders()
      loadDocs()
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
    } finally {
      setBusy(false)
      setProgress('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Delete file ──
  const handleDeleteFile = async (doc: Document) => {
    if (!confirm(`Delete "${doc.filename}"? This can't be undone.`)) return
    setError('')
    const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Could not delete')
      return
    }
    loadFolders()
    loadDocs()
  }

  // Hooks MUST be called before any early returns. Even though
  // `selectedFolderName` only renders below the !me guard, useMemo
  // has to run on every render in the same order.
  const selectedFolderName = useMemo(() => {
    if (selectedFolder === null) return 'All files'
    if (selectedFolder === 'root') return 'Unfiled'
    const f = folders.find(x => x.id === selectedFolder)
    return f?.name || 'Folder'
  }, [selectedFolder, folders])

  if (!me) return <div className="p-8 text-slate-400 italic">Loading…</div>

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">📁 Documents</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAdmin
                ? 'Upload files for everyone in your company to see.'
                : 'View and download files shared by your company admins.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}
        {progress && (
          <div className="mb-3 px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg">
            {progress}
          </div>
        )}

        {/* Folders */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Folders</h2>
            {isAdmin && !showNewFolder && (
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-medium px-3 py-1.5 rounded-lg"
              >
                + New folder
              </button>
            )}
          </div>

          {showNewFolder && (
            <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder() }}
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={busy || !newFolderName.trim()}
                className="text-sm bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => { setShowNewFolder(false); setNewFolderName('') }}
                className="text-sm text-slate-500 hover:text-slate-800 px-2"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {/* All files pseudo-folder */}
            <FolderTile
              icon="📂"
              name="All files"
              count={folders.reduce((s, f) => s + f.file_count, 0) + rootCount}
              active={selectedFolder === null}
              onClick={() => setSelectedFolder(null)}
            />
            {/* Unfiled (root) pseudo-folder */}
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
                onDelete={isAdmin ? () => handleDeleteFolder(f) : undefined}
              />
            ))}
          </div>
        </section>

        {/* Files in current folder */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              {selectedFolderName} ({docs.length})
            </h2>
            {isAdmin && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={e => onFilesPicked(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  📤 Upload {selectedFolder === null ? '' : 'here'}
                </button>
              </>
            )}
          </div>

          {loadingDocs ? (
            <p className="text-slate-400 italic text-sm py-6">Loading files…</p>
          ) : docs.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm text-slate-700 font-medium">No files yet</p>
              {isAdmin && (
                <p className="text-xs text-slate-500 mt-1">
                  Use the Upload button above to add some.
                </p>
              )}
            </div>
          ) : (
            <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {docs.map(d => (
                <FileRow
                  key={d.id}
                  doc={d}
                  isAdmin={isAdmin}
                  onDelete={() => handleDeleteFile(d)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function FolderTile({
  icon, name, count, active, onClick, onDelete,
}: {
  icon: string
  name: string
  count: number
  active: boolean
  onClick: () => void
  onDelete?: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-3 py-3 rounded-xl border transition ${
          active
            ? 'bg-slate-800 text-white border-slate-800'
            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl flex-shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{name}</p>
            <p className={`text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>
              {count} {count === 1 ? 'file' : 'files'}
            </p>
          </div>
        </div>
      </button>
      {onDelete && !active && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-1 right-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded p-1 text-xs"
          aria-label="Delete folder"
          title="Delete folder"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function FileRow({ doc, isAdmin, onDelete }: { doc: Document; isAdmin: boolean; onDelete: () => void }) {
  const icon = mimeIcon(doc.mime_type)
  const isImage = doc.mime_type?.startsWith('image/')

  return (
    <li className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition">
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 font-medium truncate">{doc.filename}</p>
        <p className="text-xs text-slate-500 truncate">
          {formatBytes(doc.size_bytes)} · uploaded {formatDate(doc.uploaded_at)} by {doc.uploaded_by_name}
        </p>
      </div>
      {doc.signed_url && (
        <a
          href={doc.signed_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-lg flex-shrink-0"
        >
          {isImage ? 'View' : 'Download'}
        </a>
      )}
      {isAdmin && (
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1.5 rounded-lg flex-shrink-0"
          aria-label="Delete file"
          title="Delete file"
        >
          🗑
        </button>
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
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
