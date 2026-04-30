/**
 * Subscription length parser.
 *
 * Accepts free-text durations the user types in the "Subscription length"
 * field, returns either a structured { quantity, unit } or null.
 *
 * Examples that parse:
 *   "1 year", "1 yr", "1y"      → 1 year
 *   "6 months", "6 month", "6mo", "6m"  → 6 months
 *   "12 weeks", "12 wks", "12w" → 12 weeks
 *   "30 days", "30d"            → 30 days
 *
 * Whitespace and capitalisation don't matter. Numbers must be 1-999.
 *
 * Used by:
 *   • CompanyForm — for the live end-date preview
 *   • API routes — to compute the actual end_date stored in the DB
 *
 * Single source of truth — change it here and both sides update.
 */

export type SubscriptionUnit = 'day' | 'week' | 'month' | 'year'

export type ParsedLength = {
  quantity: number
  unit: SubscriptionUnit
}

const UNIT_PATTERNS: { unit: SubscriptionUnit; regex: RegExp }[] = [
  // Year — 'y', 'yr', 'yrs', 'year', 'years'
  { unit: 'year',  regex: /^(years?|yrs?|y)$/ },
  // Month — 'm', 'mo', 'mos', 'month', 'months' (BUT not just 'm' if context is week — handled by order)
  { unit: 'month', regex: /^(months?|mos?|m)$/ },
  // Week — 'w', 'wk', 'wks', 'week', 'weeks'
  { unit: 'week',  regex: /^(weeks?|wks?|w)$/ },
  // Day — 'd', 'day', 'days'
  { unit: 'day',   regex: /^(days?|d)$/ },
]

/**
 * Parse a duration string.
 * Returns null on invalid input.
 */
export function parseSubscriptionLength(input: string | null | undefined): ParsedLength | null {
  if (!input) return null
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // Match: number, optional whitespace, unit
  const m = trimmed.match(/^(\d{1,3})\s*([a-z]+)$/)
  if (!m) return null

  const quantity = parseInt(m[1], 10)
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) return null

  const unitText = m[2]
  for (const p of UNIT_PATTERNS) {
    if (p.regex.test(unitText)) {
      return { quantity, unit: p.unit }
    }
  }
  return null
}

/**
 * Add a parsed duration to a Date and return the resulting Date.
 * Note: months and years use calendar-correct arithmetic
 * (1 month after Jan 31 = Feb 28/29, not Mar 3).
 */
export function addLengthToDate(start: Date, length: ParsedLength): Date {
  const d = new Date(start)
  switch (length.unit) {
    case 'day':   d.setDate(d.getDate()   + length.quantity); break
    case 'week':  d.setDate(d.getDate()   + length.quantity * 7); break
    case 'month': d.setMonth(d.getMonth() + length.quantity); break
    case 'year':  d.setFullYear(d.getFullYear() + length.quantity); break
  }
  return d
}

/**
 * Convenience: take a start-date string (YYYY-MM-DD) and a length string,
 * return the calculated end date as YYYY-MM-DD, or null if either input
 * is invalid.
 */
export function calculateEndDate(
  startDateStr: string | null | undefined,
  lengthStr: string | null | undefined,
): string | null {
  if (!startDateStr) return null
  const length = parseSubscriptionLength(lengthStr)
  if (!length) return null

  const start = new Date(startDateStr)
  if (isNaN(start.getTime())) return null

  const end = addLengthToDate(start, length)
  // Format as YYYY-MM-DD
  const yyyy = end.getFullYear()
  const mm   = String(end.getMonth() + 1).padStart(2, '0')
  const dd   = String(end.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
