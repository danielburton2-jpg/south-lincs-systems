'use client'
/**
 * MessageComposer
 *
 * Text input + attachment picker + send button.
 * Used inside ThreadView. Owns staged-files state, image compression,
 * upload-to-signed-URL, and the final POST to messages-with-attachments.
 *
 * After successful send, fires notifyEvent({ kind: 'message_sent', ... })
 * so other thread members get an in-app toast and a phone push.
 */
import { useRef, useState } from 'react'
import { notifyEvent } from '@/lib/notifyEvent'

const MAX_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENTS = 5
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf']
const IMAGE_MAX_DIM = 1500
const IMAGE_QUALITY = 0.82

type Staged = {
  localId: string
  file: File
  previewUrl: string
  compressedBlob?: Blob
  isImage: boolean
}

type Props = {
  threadId: string
  accent?: 'slate' | 'indigo'
  onSent?: (message: { id: string; body: string | null }) => void
}

export default function MessageComposer({ threadId, accent = 'slate', onSent }: Props) {
  const [draft, setDraft] = useState('')
  const [staged, setStaged] = useState<Staged[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const accentBg = accent === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'

  const onFilesPicked = async (files: FileList | null) => {
    setError('')
    if (!files || files.length === 0) return
    const accepted: Staged[] = []

    for (const f of Array.from(files)) {
      if (staged.length + accepted.length >= MAX_ATTACHMENTS) {
        setError(`Max ${MAX_ATTACHMENTS} attachments per message.`)
        break
      }
      const ok = ALLOWED_MIME_PREFIXES.some(p => f.type.startsWith(p))
      if (!ok) {
        setError(`Skipped ${f.name} — only images and PDFs allowed.`)
        continue
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is too large (max 25 MB).`)
        continue
      }
      const isImage = f.type.startsWith('image/')
      let compressedBlob: Blob | undefined
      if (isImage) {
        try {
          compressedBlob = await compressImage(f)
        } catch {
          compressedBlob = undefined
        }
      }
      accepted.push({
        localId: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
        compressedBlob,
        isImage,
      })
    }

    setStaged(prev => [...prev, ...accepted])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeStaged = (id: string) => {
    setStaged(prev => {
      const next = prev.filter(s => s.localId !== id)
      const removed = prev.find(s => s.localId === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }

  const handleSend = async () => {
    setError('')
    const text = draft.trim()
    if (!text && staged.length === 0) return

    setBusy(true)
    setProgress(staged.length > 0 ? 'Uploading…' : 'Sending…')

    try {
      const messageId = crypto.randomUUID()

      const attachmentMeta: Array<{
        storage_path: string
        filename: string
        mime_type: string
        size_bytes: number
        is_image: boolean
      }> = []

      for (let i = 0; i < staged.length; i++) {
        const s = staged[i]
        setProgress(`Uploading ${i + 1} of ${staged.length}…`)

        const blobToUpload: Blob = s.compressedBlob || s.file
        const sizeBytes = blobToUpload.size
        const uploadMime = s.compressedBlob ? 'image/jpeg' : s.file.type
        const filename = s.compressedBlob
          ? s.file.name.replace(/\.(heic|heif|png|jpg|jpeg|webp)$/i, '') + '.jpg'
          : s.file.name

        const signRes = await fetch(`/api/messages/threads/${threadId}/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message_id: messageId,
            filename,
            mime_type: uploadMime,
            size_bytes: sizeBytes,
          }),
        })
        const signData = await signRes.json()
        if (!signRes.ok) throw new Error(signData.error || 'Could not get upload URL')

        const putRes = await fetch(signData.signed_url, {
          method: 'PUT',
          headers: { 'Content-Type': uploadMime },
          body: blobToUpload,
        })
        if (!putRes.ok) {
          throw new Error(`Upload failed (${putRes.status})`)
        }

        attachmentMeta.push({
          storage_path: signData.storage_path,
          filename,
          mime_type: uploadMime,
          size_bytes: sizeBytes,
          is_image: s.isImage,
        })
      }

      setProgress('Sending…')
      const finalRes = await fetch(`/api/messages/threads/${threadId}/messages-with-attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          body: text,
          attachments: attachmentMeta,
        }),
      })
      const finalData = await finalRes.json()
      if (!finalRes.ok) throw new Error(finalData.error || 'Could not send')

      for (const s of staged) URL.revokeObjectURL(s.previewUrl)
      setStaged([])
      setDraft('')

      // Fire push notification — fail-silent
      notifyEvent({ kind: 'message_sent', message_id: messageId })

      onSent?.({ id: messageId, body: text || null })
    } catch (err: any) {
      setError(err?.message || 'Failed to send')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-2 sticky bottom-0">
      {staged.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-1">
          {staged.map(s => (
            <StagedPreview key={s.localId} item={s} onRemove={removeStaged} />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600 mb-1 px-1">{error}</p>}
      {busy && progress && <p className="text-xs text-slate-500 mb-1 px-1">{progress}</p>}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={e => onFilesPicked(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || staged.length >= MAX_ATTACHMENTS}
          className="text-slate-500 hover:text-slate-800 px-2 py-2 text-lg flex-shrink-0 disabled:opacity-30"
          aria-label="Attach files"
        >
          📎
        </button>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none px-3 py-2 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 max-h-32"
          disabled={busy}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={busy || (!draft.trim() && staged.length === 0)}
          className={`${accentBg} text-white px-4 py-2 rounded-2xl text-sm font-medium disabled:opacity-50 flex-shrink-0`}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

function StagedPreview({ item, onRemove }: { item: Staged; onRemove: (id: string) => void }) {
  return (
    <div className="relative flex-shrink-0 group">
      {item.isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.previewUrl}
          alt={item.file.name}
          className="h-20 w-20 object-cover rounded-lg border border-slate-200"
        />
      ) : (
        <div className="h-20 w-20 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-center px-1">
          <span className="text-xl">📄</span>
          <span className="text-[9px] text-slate-600 mt-0.5 truncate w-full">
            {item.file.name}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRemove(item.localId)}
        className="absolute -top-1.5 -right-1.5 bg-slate-900 text-white rounded-full w-5 h-5 text-xs leading-none flex items-center justify-center"
        aria-label="Remove"
      >
        ×
      </button>
    </div>
  )
}

async function compressImage(file: File): Promise<Blob> {
  const dataUrl = await readFileAsDataUrl(file)
  const img = await loadImage(dataUrl)

  let { width, height } = img
  if (width > IMAGE_MAX_DIM || height > IMAGE_MAX_DIM) {
    if (width >= height) {
      height = Math.round(height * (IMAGE_MAX_DIM / width))
      width = IMAGE_MAX_DIM
    } else {
      width = Math.round(width * (IMAGE_MAX_DIM / height))
      height = IMAGE_MAX_DIM
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, 0, 0, width, height)

  const blob: Blob | null = await new Promise(resolve => {
    canvas.toBlob(b => resolve(b), 'image/jpeg', IMAGE_QUALITY)
  })
  if (!blob) throw new Error('Compression failed')
  return blob
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = src
  })
}