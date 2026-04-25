let cachedHolidays: Set<string> | null = null
let cacheExpiry: number = 0

export async function getUKBankHolidays(): Promise<Set<string>> {
  // Cache for 24 hours
  if (cachedHolidays && Date.now() < cacheExpiry) {
    return cachedHolidays
  }

  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json')
    if (!res.ok) return new Set()

    const data = await res.json()
    const holidays = new Set<string>()

    // Use England and Wales bank holidays
    const events = data['england-and-wales']?.events || []
    events.forEach((event: any) => {
      holidays.add(event.date) // YYYY-MM-DD format
    })

    cachedHolidays = holidays
    cacheExpiry = Date.now() + (24 * 60 * 60 * 1000)
    return holidays
  } catch (err) {
    console.error('Failed to fetch bank holidays:', err)
    return new Set()
  }
}

export function isBankHoliday(dateStr: string, bankHolidays: Set<string>): boolean {
  return bankHolidays.has(dateStr)
}