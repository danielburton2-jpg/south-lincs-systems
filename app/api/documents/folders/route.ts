/**
 * GET  /api/documents/folders
 *   Returns the list of folders in the caller's company along with
 *   a count of files in each folder. Anyone in the company can read.
 *
 *   Response: { folders: [{ id, name, file_count, created_at }], root_count }
 *
 * POST /api/documents/folders
 *   Admin creates a new folder.
 *   Body: { name: string }
 *   Response: { folder: { id, name, ... } }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

async function getCaller() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* no-op */ },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = adminClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return null

  return { profile, svc }
}

export async function GET() {
  const ctx = await getCaller()
  if (!ctx) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { profile, svc } = ctx

  // Folders for this company
  const { data: folders, error: fErr } = await svc
    .from('document_folders')
    .select('id, name, created_at, created_by')
    .eq('company_id', profile.company_id)
    .order('name', { ascending: true })
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })

  // Per-folder file counts + root count in one query
  const { data: docs } = await svc
    .from('documents')
    .select('folder_id')
    .eq('company_id', profile.company_id)

  const countsByFolder = new Map<string, number>()
  let rootCount = 0
  for (const d of (docs || [])) {
    if (d.folder_id) {
      countsByFolder.set(d.folder_id, (countsByFolder.get(d.folder_id) || 0) + 1)
    } else {
      rootCount += 1
    }
  }

  const enriched = (folders || []).map(f => ({
    ...f,
    file_count: countsByFolder.get(f.id) || 0,
  }))

  return NextResponse.json({ folders: enriched, root_count: rootCount })
}

export async function POST(req: NextRequest) {
  const ctx = await getCaller()
  if (!ctx) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { profile, svc } = ctx

  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const name = (body?.name || '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Folder name required' }, { status: 400 })
  if (name.length > 100) {
    return NextResponse.json({ error: 'Folder name too long (max 100)' }, { status: 400 })
  }

  // Check for duplicate (same company, case-insensitive)
  const { data: existing } = await svc
    .from('document_folders')
    .select('id')
    .eq('company_id', profile.company_id)
    .ilike('name', name)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'A folder with that name already exists' }, { status: 400 })
  }

  const { data: folder, error: cErr } = await svc
    .from('document_folders')
    .insert({
      company_id: profile.company_id,
      name,
      created_by: profile.id,
    })
    .select('id, name, created_at, created_by')
    .single()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  return NextResponse.json({ folder: { ...folder, file_count: 0 } })
}
