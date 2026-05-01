'use client'

/**
 * useRealtimeRefresh — subscribe to one or more Supabase tables and
 * call a refresh handler whenever any of them change.
 *
 * Use it from page components like:
 *
 *   const reload = useCallback(async () => {
 *     // your existing fetch-and-set logic
 *   }, [companyId])
 *
 *   useRealtimeRefresh(
 *     'holidays-page',
 *     [
 *       { table: 'holiday_requests',    companyId },
 *       { table: 'balance_adjustments', companyId },
 *       { table: 'profiles',            companyId },
 *     ],
 *     reload,
 *     !!companyId,
 *   )
 *
 * Each subscription is filtered to `company_id=eq.<companyId>` so you
 * only get notifications for your own company's data.
 *
 * For tables WITHOUT a company_id column (e.g. 'features'), pass
 * `companyId: null` and the subscription listens to ALL changes on
 * that table. Use sparingly — it's noisier.
 *
 * The `enabled` flag lets you defer subscription until prerequisites
 * are loaded (e.g. you don't have the companyId yet).
 *
 * Cleanup on unmount is automatic.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase'

type TableSpec = {
  /** Table name in the public schema, e.g. 'holiday_requests' */
  table: string
  /** Company id to filter by. Pass null to listen to ALL changes on the table. */
  companyId?: string | null
  /** Custom filter expression (e.g. 'user_id=eq.<id>'). Overrides companyId if set. */
  filter?: string
}

const supabase = createClient()

export function useRealtimeRefresh(
  channelName: string,
  tables: TableSpec[],
  onChange: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return
    if (!tables || tables.length === 0) return

    let channel = supabase.channel(channelName)

    for (const t of tables) {
      const filter = t.filter
        ? t.filter
        : (t.companyId ? `company_id=eq.${t.companyId}` : undefined)

      channel = channel.on(
        // Cast required because Supabase types are strict about literal 'postgres_changes'
        // but the runtime accepts the string fine.
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: t.table,
          ...(filter ? { filter } : {}),
        },
        () => {
          onChange()
        },
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // We deliberately keep onChange out of the deps. Pages should pass
    // a stable reference (useCallback). If the array of tables changes
    // identity on every render, this resubscribes, which is undesirable.
    // Stringify the table specs to detect real changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, JSON.stringify(tables)])
}
