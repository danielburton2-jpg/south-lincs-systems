'use client'

/**
 * /dashboard/messages — admin/manager thread list
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import ThreadList from '@/components/messaging/ThreadList'
import ComposeModal from '@/components/messaging/ComposeModal'

const supabase = createClient()

export default function DashboardMessages() {
  const router = useRouter()
  const [me, setMe] = useState<{ id: string } | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.push('/login')
      else setMe({ id: user.id })
    })
  }, [router])

  if (!me) return <div className="p-8 text-slate-400 italic">Loading…</div>

  return (
    <div className="h-screen flex flex-col">
      <ThreadList
        onOpenThread={(id) => router.push(`/dashboard/messages/${id}`)}
        onCompose={() => setComposeOpen(true)}
        accent="slate"
      />
      {composeOpen && (
        <ComposeModal
          currentUserId={me.id}
          accent="slate"
          onClose={() => setComposeOpen(false)}
          onCreated={(threadId) => {
            setComposeOpen(false)
            router.push(`/dashboard/messages/${threadId}`)
          }}
        />
      )}
    </div>
  )
}
