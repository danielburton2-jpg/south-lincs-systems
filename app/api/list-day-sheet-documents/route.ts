import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/list-day-sheet-documents
 *
 * Body: { day_sheet_id }
 *
 * Returns: {
 *   documents: [{
 *     id, filename, mime_type, size_bytes,
 *     uploaded_at, uploaded_by_name,
 *     signed_url    // 10-minute signed URL for download/preview
 *   }]
 * }
 *
 * Anyone in the same company as the day sheet can list its
 * attachments — this is read-only and matches how documents work
 * elsewhere. Admin gating only applies to attaching/detaching.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { day_sheet_id } = body
    if (!day_sheet_id) {
      return NextResponse.json({ error: 'day_sheet_id is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Pull the link rows joined with the documents.
    const { data: links, error: linkErr } = await supabase
      .from('day_sheet_documents')
      .select(`
        document_id,
        documents (
          id, filename, mime_type, size_bytes, uploaded_at,
          uploaded_by, storage_path
        )
      `)
      .eq('day_sheet_id', day_sheet_id)

    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 })

    const docs = (links || [])
      .map((row: any) => row.documents)
      .filter(Boolean)

    // Resolve uploader names (one round trip if there are any docs).
    const uploaderIds = Array.from(new Set(
      docs.map((d: any) => d.uploaded_by).filter(Boolean)
    ))
    const nameMap = new Map<string, string>()
    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', uploaderIds)
      ;(profiles || []).forEach((p: any) => nameMap.set(p.id, p.full_name || ''))
    }

    // Build signed URLs for each document. Same TTL as the Documents
    // page (10 minutes). If signing fails for one doc, skip its URL
    // rather than failing the whole list.
    const out = await Promise.all(
      docs.map(async (d: any) => {
        let signed_url: string | null = null
        try {
          const { data, error } = await supabase
            .storage
            .from('documents')
            .createSignedUrl(d.storage_path, 60 * 10)
          if (error) {
            console.warn('[list-day-sheet-documents] sign url error:', error.message)
          } else {
            signed_url = data?.signedUrl || null
          }
        } catch (e: any) {
          console.warn('[list-day-sheet-documents] sign url threw:', e?.message)
        }
        return {
          id: d.id,
          filename: d.filename,
          mime_type: d.mime_type,
          size_bytes: d.size_bytes,
          uploaded_at: d.uploaded_at,
          uploaded_by_name: d.uploaded_by ? nameMap.get(d.uploaded_by) || '' : '',
          signed_url,
        }
      })
    )

    // Sort: newest uploads first.
    out.sort((a, b) => {
      const at = a.uploaded_at || ''
      const bt = b.uploaded_at || ''
      return bt.localeCompare(at)
    })

    return NextResponse.json({ documents: out })
  } catch (err: any) {
    console.error('list-day-sheet-documents error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
