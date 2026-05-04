'use client'

/**
 * /employee — the home screen.
 *
 * Visual structure (top to bottom):
 *   • Hero header — modern indigo gradient with subtle texture, greeting
 *     adapts to time of day, date, profile avatar in top-right
 *   • Quick info chips — holiday balance (when present)
 *   • App grid — coloured tiles per enabled feature, 2 columns on phone,
 *     3+ on bigger screens
 *   • Bottom nav — Home / Profile
 *
 * Routes by feature SLUG (not name) so the URL is stable regardless of
 * what the feature display name happens to be.
 *
 * For now, tile clicks may go to pages we haven't built yet (404). That's
 * expected — each feature ships its own pages later.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  job_title: string | null
  company_id: string | null
  holiday_entitlement: number | null
}

type Company = {
  id: string
  name: string
  end_date: string | null
  override_end_date: string | null
}

type Feature = {
  id: string
  slug: string
  name: string
  description: string | null
}

// Per-feature theming. Adding a new feature? Add it here. If a slug
// isn't in the map, falls back to the neutral default.
type Theme = {
  emoji: string
  bg: string         // tile background — light tint
  ring: string       // ring colour for active state / hover lift
  iconBg: string     // background behind the emoji icon
  text: string       // title text colour
}

const THEMES: Record<string, Theme> = {
  holidays: {
    emoji: '🏖️',
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    iconBg: 'bg-amber-100',
    text: 'text-amber-900',
  },
  vehicle_checks: {
    emoji: '🚛',
    bg: 'bg-rose-50',
    ring: 'ring-rose-200',
    iconBg: 'bg-rose-100',
    text: 'text-rose-900',
  },
  schedules: {
    emoji: '📅',
    bg: 'bg-teal-50',
    ring: 'ring-teal-200',
    iconBg: 'bg-teal-100',
    text: 'text-teal-900',
  },
  services: {
    emoji: '🔧',
    bg: 'bg-indigo-50',
    ring: 'ring-indigo-200',
    iconBg: 'bg-indigo-100',
    text: 'text-indigo-900',
  },
  documents: {
    emoji: '📁',
    bg: 'bg-violet-50',
    ring: 'ring-violet-200',
    iconBg: 'bg-violet-100',
    text: 'text-violet-900',
  },
  phone_directory: {
    emoji: '📞',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    iconBg: 'bg-emerald-100',
    text: 'text-emerald-900',
  },
}

const DEFAULT_THEME: Theme = {
  emoji: '📌',
  bg: 'bg-slate-50',
  ring: 'ring-slate-200',
  iconBg: 'bg-slate-100',
  text: 'text-slate-900',
}

const greeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const firstName = (full: string | null | undefined) =>
  (full || '').split(' ')[0] || ''

const todayLabel = () =>
  new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

export default function EmployeeHome() {
  const router = useRouter()
  const unreadMessages = useUnreadMessagesCount()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/get-employee-home')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')
        if (cancelled) return
        setProfile(data.profile)
        setCompany(data.company)
        setFeatures(data.features || [])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400">Loading…</p>
      </main>
    )
  }
  if (error || !profile) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg max-w-md w-full">
          {error || 'Unable to load your home page.'}
        </div>
      </main>
    )
  }

  const balance = profile.holiday_entitlement
  const showHolidayBalance = balance !== null && balance !== undefined &&
    features.some(f => f.slug === 'holidays')

  // Subscription expiry warning (employee version, low-key)
  let daysRemaining: number | null = null
  let effectiveEnd: string | null = null
  if (company) {
    effectiveEnd = company.override_end_date || company.end_date
    if (effectiveEnd) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const end = new Date(effectiveEnd); end.setHours(0, 0, 0, 0)
      daysRemaining = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-24">

      {/* HERO HEADER */}
      <header className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-800 text-white px-6 pt-10 pb-10 rounded-b-[2rem] shadow-xl">
        {/* Subtle dot texture on top of the gradient */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <p className="text-indigo-100/90 text-xs font-medium tracking-wide">
              {todayLabel()}
            </p>
            <button
              onClick={() => router.push('/employee/profile')}
              className="w-11 h-11 bg-white/15 backdrop-blur-sm rounded-full flex items-center justify-center font-semibold text-white hover:bg-white/25 active:scale-95 transition"
              aria-label="My profile"
            >
              {firstName(profile.full_name).charAt(0).toUpperCase() || '?'}
            </button>
          </div>
          <h1 className="text-3xl font-bold leading-tight">
            {greeting()},<br />
            <span className="text-indigo-100">{firstName(profile.full_name) || 'there'}</span>
          </h1>
          {company?.name && (
            <p className="text-indigo-100/80 text-sm mt-2">{company.name}</p>
          )}
        </div>
      </header>

      {/* CONTENT */}
      <div className="px-5 pt-5 space-y-4">

        {/* Subscription expiry — quiet info card */}
        {daysRemaining !== null && daysRemaining <= 14 && daysRemaining >= 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm flex items-center gap-2">
            <span aria-hidden>⏳</span>
            <p className="text-amber-800">
              Your company subscription expires in {daysRemaining} day{daysRemaining === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        {/* Holiday balance — single chip */}
        {showHolidayBalance && (
          <button
            onClick={() => router.push('/employee/holidays')}
            className="w-full bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-2xl shadow-md p-4 flex items-center gap-3 active:scale-[0.99] transition"
          >
            <span className="text-3xl" aria-hidden>🏖️</span>
            <div className="flex-1 text-left">
              <p className="text-xs text-white/85 leading-tight">Holiday balance</p>
              <p className="text-lg font-bold leading-tight">
                {balance} day{balance === 1 ? '' : 's'} remaining
              </p>
            </div>
            <span className="text-white/70 text-xl" aria-hidden>›</span>
          </button>
        )}

        {/* Messages — always available, sits above the configurable feature grid */}
        <button
          onClick={() => router.push('/employee/messages')}
          className="w-full bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-2xl shadow-md p-4 flex items-center gap-3 active:scale-[0.99] transition"
        >
          <span className="text-3xl" aria-hidden>💬</span>
          <div className="flex-1 text-left">
            <p className="text-xs text-white/85 leading-tight">Messages</p>
            <p className="text-lg font-bold leading-tight">
              {unreadMessages > 0
                ? `${unreadMessages} new ${unreadMessages === 1 ? 'message' : 'messages'}`
                : 'Chat with your team'}
            </p>
          </div>
          {unreadMessages > 0 && (
            <span className="bg-white text-violet-700 text-xs font-bold rounded-full min-w-[24px] h-6 px-2 flex items-center justify-center">
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
          <span className="text-white/70 text-xl" aria-hidden>›</span>
        </button>

        {/* APP GRID */}
        <section className="pt-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
            Your apps
          </h2>

          {features.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <div className="text-3xl mb-2" aria-hidden>📭</div>
              <p className="text-slate-500 text-sm">
                You don&apos;t have any apps enabled yet.
              </p>
              <p className="text-slate-400 text-xs mt-1">
                Speak to your manager to get access.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {features.map((f) => {
                const t = THEMES[f.slug] || DEFAULT_THEME
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      // Most slugs map cleanly to URLs (slug.replace(/_/g, '-')),
                      // but some have a different page name for historical
                      // reasons. Hard-code overrides here.
                      const SLUG_TO_ROUTE: Record<string, string> = {
                        services_mot: 'services',  // page lives at /employee/services not /services-mot
                      }
                      const segment = SLUG_TO_ROUTE[f.slug] || f.slug.replace(/_/g, '-')
                      router.push(`/employee/${segment}`)
                    }}
                    className={`relative ${t.bg} ring-1 ${t.ring} hover:ring-2 active:scale-[0.98] rounded-2xl p-4 text-left transition shadow-sm`}
                  >
                    <div className={`w-12 h-12 rounded-xl ${t.iconBg} flex items-center justify-center mb-3 text-2xl`}>
                      {t.emoji}
                    </div>
                    <p className={`font-semibold text-sm leading-tight ${t.text}`}>
                      {f.name}
                    </p>
                    {f.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-snug">
                        {f.description}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* BOTTOM NAV */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg safe-bottom">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto">
          <NavButton
            label="Home"
            emoji="🏠"
            active={true}
            onClick={() => router.push('/employee')}
          />
          <NavButton
            label="Profile"
            emoji="👤"
            active={false}
            onClick={() => router.push('/employee/profile')}
          />
        </div>
      </nav>
    </main>
  )
}

function NavButton({
  label, emoji, active, onClick,
}: {
  label: string
  emoji: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-6 py-1 rounded-lg transition ${
        active ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      <span className="text-xl" aria-hidden>{emoji}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
