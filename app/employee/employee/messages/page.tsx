'use client'

/**
 * /employee/messages — driver/mechanic thread list
 *
 * Mobile-first. Uses the indigo accent to match the rest of /employee.
 * Bottom nav (Home / Profile) lives outside this component on the
 * employee app's standard wrapper.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import ThreadList from '@/components/messaging/ThreadList'
import ComposeModal from '@/components/messaging/ComposeModal'

const supabase = createClient()

export default function EmployeeMessages() {
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
    <div className="h-screen flex flex-col bg-white pb-20">
      {/* Header — indigo gradient to match /employee aesthetic */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-4">
        <button
          onClick={() => router.push('/employee')}
          className="text-xs text-indigo-100 hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold mt-2">💬 Messages</h1>
      </div>

      <div className="flex-1 min-h-0">
        <ThreadList
          onOpenThread={(id) => router.push(`/employee/messages/${id}`)}
          onCompose={() => setComposeOpen(true)}
          accent="indigo"
        />
      </div>

      {composeOpen && (
        <ComposeModal
          currentUserId={me.id}
          accent="indigo"
          onClose={() => setComposeOpen(false)}
          onCreated={(threadId) => {
            setComposeOpen(false)
            router.push(`/employee/messages/${threadId}`)
          }}
        />
      )}
    </div>
  )
}
