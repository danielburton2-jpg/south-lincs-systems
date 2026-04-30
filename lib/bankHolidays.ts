/**
 * UK bank holidays helper.
 *
 * Fetches from https://www.gov.uk/bank-holidays.json (free, no API key,
 * no rate limit, returned as JSON of all UK bank holidays past + future).
 *
 * Cached in module memory after the first successful fetch — that means
 * the same browser session won't re-fetch unless the page is refreshed.
 *
 * Used in two places:
 *   • Employee booking form — exclude bank holidays from the days count
 *   • Calendar views — colour bank holiday cells differently
 */

let cache: { dates: Set<string>; names: Record<string, string> } | null = null

export type BankHolidaysData = {
  dates: Set<string>
  names: Record<string, string>
}

export async function getUKBankHolidays(): Promise<BankHolidaysData> {
  if (cache) return cache
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json')
    if (!res.ok) return { dates: new Set(), names: {} }
    const data = await res.json()
    const events = data['england-and-wales']?.events || []
    const dates = new Set<string>()
    const names: Record<string, string> = {}
    for (const ev of events) {
      dates.add(ev.date)
      names[ev.date] = ev.title
    }
    cache = { dates, names }
    return cache
  } catch (err) {
    console.error('Failed to fetch bank holidays:', err)
    // Return empty so calling code degrades gracefully — booking still works,
    // bank holidays just aren't excluded from the day count.
    return { dates: new Set(), names: {} }
  }
}

/**
 * Convenience: just the dates set (most common use case).
 */
export async function getBankHolidayDates(): Promise<Set<string>> {
  const { dates } = await getUKBankHolidays()
  return dates
}
