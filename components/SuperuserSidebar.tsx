'use client'

/**
 * SuperuserSidebar — permanent left rail for /superuser/* pages.
 *
 *   • Dashboard link at the top
 *   • Collapsible sections below
 *   • Sub-item click closes the open section
 *   • Logout fixed at the bottom — records LOGOUT audit event before
 *     signing out so we know who left and when
 */

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

type Props = {
  user: {
    full_name: string | null
    email: string | null
    role: string
  }
}

type SubItem = { label: string; href: string }
type Section = { label: string; basePath: string; subItems: SubItem[] }

const SECTIONS: Section[] = [
  {
    label: 'Companies',
    basePath: '/superuser/companies',
    subItems: [
      { label: 'Create', href: '/superuser/companies/create' },
      { label: 'Edit',   href: '/superuser/companies/edit' },
    ],
  },
]

// Best-effort audit — never blocks logout
async function recordAudit(payload: any) {
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* swallow */
  }
}

export default function SuperuserSidebar({ user }: Props) {
  const pathname = usePathname() || ''
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const toggle = (label: string) => {
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }))
  }
  const closeAll = () => setOpenSections({})

  const handleSignOut = async () => {
    // Capture the user id from the active session before signing out
    let user_id: string | undefined
    try {
      const { data: { user: authedUser } } = await supabase.auth.getUser()
      user_id = authedUser?.id
    } catch { /* fine */ }

    // Record logout — wait for it before signing out so the audit goes
    // through with the still-valid session in cookies (middleware lets
    // /api/audit through anyway, but waiting also avoids a fire-and-forget race)
    await recordAudit({
      user_id,
      user_email: user.email,
      user_role: user.role,
      action: 'LOGOUT',
      entity: 'auth',
      entity_id: user_id,
    })

    try {
      await supabase.auth.signOut()
    } catch { /* fine */ }
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  }

  const dashboardActive = pathname === '/superuser'
  const superusersActive = pathname === '/superuser/superusers' || pathname.startsWith('/superuser/superusers/')

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col flex-shrink-0">
      <div className="px-6 py-5 border-b border-slate-800">
        <h1 className="text-lg font-bold tracking-tight text-white">South Lincs Systems</h1>
        <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">Superuser</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <Link
          href="/superuser"
          onClick={closeAll}
          className={`block px-3 py-2 mb-2 rounded-lg text-sm font-medium transition ${
            dashboardActive
              ? 'bg-slate-800 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          Dashboard
        </Link>

        <Link
          href="/superuser/superusers"
          onClick={closeAll}
          className={`block px-3 py-2 mb-2 rounded-lg text-sm font-medium transition ${
            superusersActive
              ? 'bg-slate-800 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          Superusers
        </Link>

        {SECTIONS.map((section) => {
          const isOpen = !!openSections[section.label]
          return (
            <div key={section.label} className="mb-2">
              <button
                type="button"
                onClick={() => toggle(section.label)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition rounded-lg hover:bg-slate-800/40"
              >
                <span>{section.label}</span>
              </button>
              {isOpen && (
                <ul className="mt-1">
                  {section.subItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/')
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={closeAll}
                          className={`block px-3 py-2 rounded-lg text-sm transition ${
                            active
                              ? 'bg-slate-800 text-white font-medium'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800">
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition flex items-center gap-2"
        >
          <span aria-hidden>↩</span>
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
