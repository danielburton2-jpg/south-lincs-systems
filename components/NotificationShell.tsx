'use client'
/**
 * NotificationShell
 *
 * Mounted inside a server-component layout to:
 *  1. Provide the NotificationProvider context to all descendants
 *  2. Mount the realtime listener for the given scope
 *
 * The layout passes the current user's id/company/role from a server
 * fetch, so the listener can subscribe to the right filtered events.
 */
import NotificationProvider from './NotificationProvider'
import { useNotificationsListener } from './useNotificationsListener'

type Props = {
  userId: string
  companyId: string | null
  role: string
  scope: 'dashboard' | 'employee'
  children: React.ReactNode
}

export default function NotificationShell({ userId, companyId, role, scope, children }: Props) {
  return (
    <NotificationProvider>
      <Inner userId={userId} companyId={companyId} role={role} scope={scope}>
        {children}
      </Inner>
    </NotificationProvider>
  )
}

function Inner({ userId, companyId, role, scope, children }: Props) {
  // The hook reads from the NotificationProvider context, which is why
  // it has to live inside the provider rather than alongside it.
  useNotificationsListener({ userId, companyId, role, scope })
  return <>{children}</>
}
