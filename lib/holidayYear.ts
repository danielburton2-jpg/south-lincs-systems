/**
 * Holiday year helper.
 *
 * Each company has a `holiday_year_start` date (e.g. 2026-04-01 means
 * the year runs April 1 to March 31). This helper figures out:
 *
 *   • Given a date, what year label does it fall in? ('2026-2027')
 *   • Is that the company's CURRENT year right now?
 *
 * Stored on each holiday request so we can:
 *   1. Display "Next year" badges on requests that aren't current
 *   2. Decide at approval time whether to deduct from balance
 *   3. Filter requests by year for displays
 *
 * The "current year" boundary moves as time passes — but we record
 * is_current_year at submission time. Edge case: a request submitted
 * Mar 25 for Apr 5 holiday is "next year" at submission (since current
 * year ends Mar 31). It STAYS marked as next_year even after the year
 * rolls over. That's deliberate — when the year rolls over, those
 * approved-not-deducted requests start counting against the new year's
 * balance via the live computed balance (we never need to re-tag them).
 */

export type HolidayYear = {
  label: string         // e.g. '2026-2027'
  startDate: string     // YYYY-MM-DD (inclusive)
  endDate: string       // YYYY-MM-DD (inclusive — the day before next year's start)
}

/**
 * Format a Date as YYYY-MM-DD using LOCAL time (not UTC).
 * Important: using toISOString() shifts dates by timezone in some locales.
 */
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Given a date and the company's holiday_year_start (just used for
 * its month + day — the year part of holiday_year_start is ignored),
 * return the holiday year that contains that date.
 *
 * Example: date=2026-07-15, year_start=2026-04-01
 *   → returns label='2026-2027', start=2026-04-01, end=2027-03-31
 *
 * Example: date=2026-02-15, year_start=2026-04-01
 *   → returns label='2025-2026', start=2025-04-01, end=2026-03-31
 *
 * If no year_start is set, falls back to a calendar year (Jan 1).
 */
export function holidayYearForDate(
  date: string | Date,
  yearStartDate: string | null | undefined,
): HolidayYear {
  const d = typeof date === 'string' ? new Date(date) : new Date(date)

  // Default = calendar year
  let monthIdx = 0    // January
  let dayOfMonth = 1
  if (yearStartDate) {
    const ys = new Date(yearStartDate)
    if (!isNaN(ys.getTime())) {
      monthIdx = ys.getMonth()
      dayOfMonth = ys.getDate()
    }
  }

  // Boundary in the date's year
  const boundaryThisYear = new Date(d.getFullYear(), monthIdx, dayOfMonth)
  let startYear: number
  if (d >= boundaryThisYear) {
    startYear = d.getFullYear()
  } else {
    startYear = d.getFullYear() - 1
  }

  const start = new Date(startYear, monthIdx, dayOfMonth)
  const end = new Date(startYear + 1, monthIdx, dayOfMonth)
  end.setDate(end.getDate() - 1)

  return {
    label: `${startYear}-${startYear + 1}`,
    startDate: ymd(start),
    endDate: ymd(end),
  }
}

/**
 * Is the given date in the company's CURRENT holiday year (relative to
 * today)?
 */
export function isCurrentHolidayYear(
  date: string | Date,
  yearStartDate: string | null | undefined,
): boolean {
  const todayYear = holidayYearForDate(new Date(), yearStartDate)
  const dateYear = holidayYearForDate(date, yearStartDate)
  return todayYear.label === dateYear.label
}

/**
 * Get the current and next year labels (used for filtering).
 */
export function currentAndNextYearLabels(
  yearStartDate: string | null | undefined,
): { current: string; next: string } {
  const current = holidayYearForDate(new Date(), yearStartDate)
  const nextStart = new Date(current.endDate)
  nextStart.setDate(nextStart.getDate() + 1)
  const next = holidayYearForDate(nextStart, yearStartDate)
  return { current: current.label, next: next.label }
}
