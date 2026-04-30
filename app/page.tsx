import { redirect } from 'next/navigation'

/**
 * Root URL just bounces to /login. Middleware will then bounce
 * authenticated users on to their role's dashboard.
 */
export default function HomePage() {
  redirect('/login')
}
