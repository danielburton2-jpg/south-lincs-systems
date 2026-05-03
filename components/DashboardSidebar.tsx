'use client'

/**
 * DashboardSidebar — left rail for /dashboard/* pages.
 *
 * Holidays section visibility:
 *   • Admin → always shown, sub-item "Review Requests"
 *   • Manager/user with EDIT on Holidays → shown, sub-item "Review Requests"
 *   • Manager/user with READ-only on Holidays → shown, sub-item "My Holidays"
 *
 * Schedules section visibility (depends on company's schedules_mode):
 *
 *   When schedules_mode = 'shift_patterns' (default):
 *     • Admin → "Schedules" / "Calendar" / "Assign" / "Reports"
 *     • Manager/user with EDIT → all of the above
 *     • Manager/user with READ-only → "Schedules" + "Calendar"
 *
 *   When schedules_mode = 'day_sheet' (added in migration 029):
 *     • Section is labelled "Day Sheet" instead of "Schedules"
 *     • Sub-items: "Day Sheets" (list — has its own + New button),
 *       "Assign" (weekly driver-on-job grid),
 *       "Day View" (per-day vehicle + notes; doubles as printout),
 *       "Reports" (historical day sheets + filters + CSV/PDF export)
 *
 * The two modes are mutually exclusive — exactly one (or neither, if
 * the Schedules feature isn't enabled at all) is visible at a time.
 *
 * Other sections:
 *   • Admin → MANAGE USERS (Add User / Edit User)
 *   • Manager → MY TEAM (View Team)
 *
 * Always visible: Dashboard, My Profile, Sign out.
 */

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useUnreadMessagesCount } from '@/lib/useUnreadMessagesCount'

const supabase = createClient()

type Props = {
  user: {
    full_name: string | null
    email: string | null
    role: string
  }
  holidaysCanEdit?: boolean
  hasHolidayAccess?: boolean
  schedulesCanEdit?: boolean
  schedulesCanViewAll?: boolean
  /**
   * True if Schedules feature is enabled for the user's company AND the
   * user has any access to it. Mode-agnostic — kept for compatibility
   * with any code that still reads it. The sidebar itself uses the two
   * mode-specific flags below.
   */
  hasSchedulesAccess?: boolean
  /**
   * True when the company is in 'shift_patterns' mode AND the user has
   * Schedules access. Drives whether the existing Schedules section
   * (Schedules / Calendar / Assign / Reports) is shown.
   */
  hasSchedulesShiftPatternsAccess?: boolean
  /**
   * True when the company is in 'day_sheet' mode AND the user has
   * Schedules access. Drives whether the new Day Sheet section is shown.
   */
  hasSchedulesDaySheetAccess?: boolean
  hasVehiclesAccess?: boolean
  hasServicesAccess?: boolean
  hasDocumentsAccess?: boolean
}

type SubItem = { label: string; href: string; disabled?: boolean }
type Section = { label: string; basePath: string; subItems: SubItem[] }

async function recordAudit(payload: any) {
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch { /* swallow */ }
}

export default function DashboardSidebar({
  user,
  holidaysCanEdit, hasHolidayAccess,
  schedulesCanEdit, schedulesCanViewAll,
  hasSchedulesShiftPatternsAccess,
  hasSchedulesDaySheetAccess,
  hasVehiclesAccess,
  hasServicesAccess,
  hasDocumentsAccess,
}: Props) {
  const pathname = usePathname() || ''
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const toggle = (label: string) =>
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }))
  const closeAll = () => setOpenSections({})

  const handleSignOut = async () => {
    let user_id: string | undefined
    try {
      const { data: { user: authedUser } } = await supabase.auth.getUser()
      user_id = authedUser?.id
    } catch { /* fine */ }
    await recordAudit({
      user_id, user_email: user.email, user_role: user.role,
      action: 'LOGOUT', entity: 'auth', entity_id: user_id,
    })
    try { await supabase.auth.signOut() } catch { /* fine */ }
    if (typeof window !== 'undefined') window.location.href = '/login'
  }

  const dashboardActive = pathname === '/dashboard'
  const messagesActive = pathname.startsWith('/dashboard/messages')
  const documentsActive = pathname.startsWith('/dashboard/documents')
  const profileActive = pathname.startsWith('/dashboard/profile')

  const unreadMessages = useUnreadMessagesCount()

  const sections: Section[] = []

  if (user.role === 'admin') {
    sections.push({
      label: 'Manage Users', basePath: '/dashboard/users',
      subItems: [
        { label: 'Add User',  href: '/dashboard/users/add' },
        { label: 'Edit User', href: '/dashboard/users' },
      ],
    })
  } else if (user.role === 'manager') {
    sections.push({
      label: 'My Team', basePath: '/dashboard/team',
      subItems: [{ label: 'View Team', href: '/dashboard/team' }],
    })
  }

  // Holidays
  // Trust the layout's `hasHolidayAccess` value — it already encodes
  // both the company-level enable and the per-user/role grant.
  const showHolidays = hasHolidayAccess
  if (showHolidays) {
    const subLabel = (user.role === 'admin' || holidaysCanEdit)
      ? 'Review Requests'
      : 'My Holidays'
    sections.push({
      label: 'Holidays', basePath: '/dashboard/holidays',
      subItems: [{ label: subLabel, href: '/dashboard/holidays' }],
    })
  }

  // Schedules — shift_patterns mode (existing behaviour)
  // Shown only when the company is in shift_patterns mode AND the user
  // has Schedules access. The day_sheet mode renders a separate section
  // below, so the two are mutually exclusive in practice.
  if (hasSchedulesShiftPatternsAccess) {
    const isAdmin = user.role === 'admin'
    const subItems: SubItem[] = [
      // Always show Schedules list — admins see all, non-admins see their own
      { label: 'Schedules', href: '/dashboard/schedules' },
    ]
    // Calendar shown to admins, OR users with view-all (or with edit, since
    // edit implies they need to see who they're assigning).
    if (isAdmin || schedulesCanViewAll || schedulesCanEdit) {
      subItems.push({ label: 'Calendar', href: '/dashboard/schedules/calendar' })
    }
    // Assign + Reports unlocked by edit (or admin).
    if (isAdmin || schedulesCanEdit) {
      subItems.push({ label: 'Assign',  href: '/dashboard/schedules/assign' })
      subItems.push({ label: 'Reports', href: '/dashboard/schedules/reports' })
    }
    sections.push({
      label: 'Schedules', basePath: '/dashboard/schedules', subItems,
    })
  }

  // Day Sheet mode — sub-items expand as the rollout progresses.
  // The "Day View" entry is the per-day vehicle + notes page; it
  // doubles as the printable day sheet (Print button on the page).
  // "New Day Sheet" was removed — the Day Sheets list page has its
  // own "+ New Day Sheet" button at the top, so the sidebar entry
  // was redundant.
  if (hasSchedulesDaySheetAccess) {
    const subItems: SubItem[] = [
      { label: 'Day Sheets', href: '/dashboard/day-sheet' },
      { label: 'Assign', href: '/dashboard/day-sheet/assign' },
      { label: 'Day View', href: '/dashboard/day-sheet/day-planner' },
      { label: 'Reports', href: '/dashboard/day-sheet/reports' },
    ]
    sections.push({
      label: 'Day Sheet',
      basePath: '/dashboard/day-sheet',
      subItems,
    })
  }

  // Vehicles — admin-only for now. Granular per-user permissions can
  // come when the driver-side checks workflow is built.
  //
  // The Vehicles section is shown when EITHER:
  //   • Vehicle checks (walkrounds) is enabled — full Vehicles +
  //     Templates + Defects + Reports
  //   • Day Sheet mode is enabled — vehicles are needed by the Day
  //     Planner so planners can pick which vehicle each driver takes
  //
  // Walkround sub-items (Templates / Defects / Reports) only appear
  // when the walkrounds feature itself is enabled. Day-sheet-only
  // companies see just the basic Vehicles entry.
  //
  // Services & MOT does not currently grant vehicle access on its own
  // — it always pairs with walkrounds in practice. If that ever
  // changes we can extend the condition here.
  const showVehicles =
    user.role === 'admin' &&
    (hasVehiclesAccess || hasSchedulesDaySheetAccess)
  if (showVehicles) {
    const subItems: SubItem[] = [
      { label: 'Vehicles', href: '/dashboard/vehicles' },
    ]
    if (hasVehiclesAccess) {
      subItems.push(
        { label: 'Templates', href: '/dashboard/vehicle-checks/templates' },
        { label: 'Defects',   href: '/dashboard/vehicle-checks/defects' },
        { label: 'Reports',   href: '/dashboard/vehicle-checks/reports' },
      )
    }
    sections.push({
      label: 'Vehicles',
      basePath: '/dashboard/vehicles',
      subItems,
    })
  }

  // Services & MOT — admin-only, only shown when the company has the
  // sub-feature enabled. Same gate logic as Vehicle Checks above.
  const showServices = user.role === 'admin' && hasServicesAccess
  if (showServices) {
    sections.push({
      label: 'Services',
      basePath: '/dashboard/services',
      subItems: [
        { label: 'Calendar',  href: '/dashboard/services/calendar' },
        { label: 'Schedule',  href: '/dashboard/services/schedule' },
        { label: 'Templates', href: '/dashboard/services/templates' },
        { label: 'Settings',  href: '/dashboard/services/settings' },
        { label: 'Reports',   href: '/dashboard/services/reports' },
      ],
    })
  }

  return (
    <aside className="w-52 bg-slate-900 text-slate-100 flex flex-col flex-shrink-0 print:hidden">
      <div className="px-4 py-4 border-b border-slate-800">
        <h1 className="text-sm font-bold tracking-tight text-white leading-tight">South Lincs Systems</h1>
        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">{user.role}</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <Link href="/dashboard" onClick={closeAll}
          className={`block px-3 py-1.5 mb-2 rounded-lg text-sm font-medium transition ${
            dashboardActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}>
          Dashboard
        </Link>

        {sections.map((section) => {
          const isOpen = !!openSections[section.label]
          return (
            <div key={section.label} className="mb-2">
              <button type="button" onClick={() => toggle(section.label)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition rounded-lg hover:bg-slate-800/40">
                <span>{section.label}</span>
              </button>
              {isOpen && (
                <ul className="mt-1">
                  {section.subItems.map((item) => {
                    // Active when path exactly matches, OR path starts with item href + '/'.
                    // Special-case: /dashboard/schedules itself should NOT light up
                    // when on /dashboard/schedules/calendar.
                    const exact = pathname === item.href
                    const isSchedulesRoot = item.href === '/dashboard/schedules'
                    const startsWith = !exact
                      && !isSchedulesRoot
                      && pathname.startsWith(item.href + '/')
                    const active = exact || startsWith

                    // Disabled placeholder items (e.g. the Day Sheet
                    // 'Coming soon' row) render as plain spans, not links —
                    // they're informational only.
                    if (item.disabled) {
                      return (
                        <li key={item.href + '-disabled'}>
                          <span
                            title="Available in a future release"
                            className="block px-3 py-1.5 rounded-lg text-sm text-slate-500 italic cursor-not-allowed"
                          >
                            {item.label}
                          </span>
                        </li>
                      )
                    }

                    return (
                      <li key={item.href}>
                        <Link href={item.href} onClick={closeAll}
                          className={`block px-3 py-1.5 rounded-lg text-sm transition ${
                            active ? 'bg-slate-800 text-white font-medium' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}>
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

        <Link href="/dashboard/messages" onClick={closeAll}
          className={`flex items-center justify-between px-3 py-1.5 mt-2 rounded-lg text-sm font-medium transition ${
            messagesActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}>
          <span>💬 Messages</span>
          {unreadMessages > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center">
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </Link>

        {hasDocumentsAccess && (
          <Link href="/dashboard/documents" onClick={closeAll}
            className={`block px-3 py-1.5 mt-2 rounded-lg text-sm font-medium transition ${
              documentsActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}>
            📁 Documents
          </Link>
        )}

        <Link href="/dashboard/profile" onClick={closeAll}
          className={`block px-3 py-1.5 mt-2 rounded-lg text-sm font-medium transition ${
            profileActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}>
          My Profile
        </Link>
      </nav>

      <div className="px-3 py-3 border-t border-slate-800">
        <button onClick={handleSignOut}
          className="w-full text-left px-3 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition flex items-center gap-2">
          <span aria-hidden>↩</span>
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
