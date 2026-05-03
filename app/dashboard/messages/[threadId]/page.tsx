'use client'

/**
 * /dashboard/messages/[threadId] — admin/manager thread view
 */
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import ThreadView from '@/components/messaging/ThreadView'

const supabase = createClient()

export default function DashboardThreadView() {
  const router = useRouter()
  const params = useParams()
  const threadId = params?.threadId as string
  const [me, setMe] = useState<{ id: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login')
      else setMe({ id: user.id })
    })
  }, [router])

  if (!me || !threadId) return <div className="p-8 text-slate-400 italic">Loading…</div>

  return (
    <div className="h-screen flex flex-col">
      <ThreadView
        threadId={threadId}
        currentUserId={me.id}
        accent="slate"
        onBack={() => router.push('/dashboard/messages')}
      />
    </div>
  )
}
