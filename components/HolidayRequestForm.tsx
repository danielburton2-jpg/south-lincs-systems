'use client'

/**
 * HolidayRequestForm — shared form for booking time off.
 *
 * Used by:
 *   • /employee/holidays  (mobile-first, sticky submit at bottom)
 *   • /dashboard/holidays  (My Holidays tab)
 *
 * Caller passes:
 *   • profile        — { id, working_days, holiday_entitlement }
 *   • company        — { id, holiday_year_start, allow_half_days, allow_early_finish }
 *   • bankHolidays   — Set<string> of YYYY-MM-DD bank holiday dates
 *   • variant        — 'employee' (sticky bottom submit) or 'dashboard' (inline submit)
 *   • onSubmitted    — called after a successful submit so the parent can refresh
 *
 * The form is fully self-contained — handles its own state, validation,
 * day calculation, next-year detection, and the actual API call.
 */

import { useState, useMemo } from 'react'
import { holidayYearForDate, isCurrentHolidayYear } from '@/lib/holidayYear'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DEFAULT_WORKING_DAYS = {
  sun: false, mon: true, tue: true, wed: true, thu: true, fri: true, sat: false,
}

const ymd = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

type RequestType = 'holiday' | 'early_finish' | 'keep_day_off'

type TypeOption = {
  value: RequestType
  emoji: string
  label: string
  description: string
  bg: string         // tile background when selected
  ring: string       // ring colour when selected
  text: string       // selected text colour
}

const ALL_TYPES: TypeOption[] = [
  {
    value: 'holiday',
    emoji: '🏖️',
    label: 'Holiday',
    description: 'Take time off (deducts from balance)',
    bg: 'bg-amber-50',
    ring: 'ring-amber-400',
    text: 'text-amber-900',
  },
  {
    value: 'early_finish',
    emoji: '🕓',
    label: 'Early Finish',
    description: 'Leave before normal end time',
    bg: 'bg-indigo-50',
    ring: 'ring-indigo-400',
    text: 'text-indigo-900',
  },
  {
    value: 'keep_day_off',
    emoji: '🚫',
    label: 'Keep Day Off',
    description: 'Refuse a shift on your normal day off',
    bg: 'bg-slate-100',
    ring: 'ring-slate-400',
    text: 'text-slate-900',
  },
]

type Props = {
  profile: any
  company: any
  bankHolidays: Set<string>
  variant?: 'employee' | 'dashboard'
  onSubmitted?: () => void
  onCancel?: () => void
}

export default function HolidayRequestForm({
  profile, company, bankHolidays,
  variant = 'employee',
  onSubmitted, onCancel,
}: Props) {
  // Form state
  const [requestType, setRequestType] = useState<RequestType>('holiday')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isHalfDay, setIsHalfDay] = useState(false)
  const [halfDayType, setHalfDayType] = useState<'morning'|'afternoon'>('morning')
  const [earlyFinishTime, setEarlyFinishTime] = useState('')
  const [reason, setReason] = useState('')

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success'|'error'>('success')

  const showMessage = (msg: string, type: 'success'|'error') => {
    setMessage(msg); setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  // Filter to types this company allows
  const availableTypes = ALL_TYPES.filter(t => {
    if (t.value === 'early_finish') return !!company?.allow_early_finish
    return true
  })

  const workingDays = profile?.working_days || DEFAULT_WORKING_DAYS
  const workingDaysCount = Object.values(workingDays).filter(Boolean).length

  // Day calculation
  const daysRequested = useMemo(() => {
    if (requestType !== 'holiday') return 0
    if (!startDate || !endDate) return 0
    const s = new Date(startDate); const e = new Date(endDate)
    if (e < s) return 0
    let count = 0
    const cur = new Date(s)
    while (cur <= e) {
      const k = DAY_KEYS[cur.getDay()]
      if (workingDays[k] && !bankHolidays.has(ymd(cur))) count++
      cur.setDate(cur.getDate() + 1)
    }
    if (isHalfDay && count === 1) return 0.5
    return count
  }, [requestType, startDate, endDate, workingDays, isHalfDay, bankHolidays])

  const balance = Number(profile?.holiday_entitlement || 0)
  const balanceAfter = balance - daysRequested

  // Year tagging
  const requestIsCurrentYear = startDate && company
    ? isCurrentHolidayYear(startDate, company.holiday_year_start)
    : true
  const requestYear = startDate && company
    ? holidayYearForDate(startDate, company.holiday_year_start)
    : null

  // Should the half-day toggle be shown?
  const canHalfDay = requestType === 'holiday'
    && company?.allow_half_days
    && startDate
    && startDate === endDate
    && daysRequested > 0

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.company_id) return

    if (requestType === 'holiday' && requestIsCurrentYear && daysRequested > balance) {
      showMessage(`You don't have enough days remaining (${balance} available)`, 'error'); return
    }
    if (requestType === 'holiday' && daysRequested === 0) {
      showMessage('Selected dates contain no working days for you', 'error'); return
    }
    if (isHalfDay && startDate !== endDate) {
      showMessage('Half day must be a single date', 'error'); return
    }

    setSubmitting(true)
    const res = await fetch('/api/holiday-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        user_id: profile.id,
        company_id: profile.company_id,
        request_type: requestType,
        start_date: startDate,
        end_date: requestType === 'early_finish' || requestType === 'keep_day_off' ? startDate : endDate,
        half_day_type: isHalfDay ? halfDayType : null,
        early_finish_time: requestType === 'early_finish' ? earlyFinishTime : null,
        reason: reason || null,
        days_requested: daysRequested,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { showMessage('Error: ' + (data.error || 'unknown'), 'error'); return }

    showMessage('Request submitted', 'success')
    setStartDate(''); setEndDate(''); setIsHalfDay(false); setReason(''); setEarlyFinishTime('')
    onSubmitted?.()
  }

  const today = ymd(new Date())

  // Disable submit when invalid
  const submitDisabled =
    submitting
    || (requestType === 'holiday' && (daysRequested === 0 || (requestIsCurrentYear && balanceAfter < 0)))
    || (requestType === 'early_finish' && !earlyFinishTime)
    || !startDate

  return (
    <form
      onSubmit={handleSubmit}
      className={variant === 'employee' ? 'pb-28' : ''}
    >
      <div className="space-y-5">

        {message && (
          <div className={`p-3 rounded-2xl text-sm font-medium ${
            messageType === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>{message}</div>
        )}

        {/* TYPE PICKER — visual cards */}
        <section>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
            What kind of request?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {availableTypes.map(t => {
              const selected = requestType === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setRequestType(t.value)}
                  className={`text-left p-4 rounded-2xl transition border ${
                    selected
                      ? `${t.bg} border-transparent ring-2 ${t.ring}`
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-2xl mb-1.5" aria-hidden>{t.emoji}</div>
                  <p className={`font-semibold text-sm ${selected ? t.text : 'text-slate-800'}`}>
                    {t.label}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{t.description}</p>
                </button>
              )
            })}
          </div>
        </section>

        {/* DATE PICKER */}
        <section>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
            {requestType === 'holiday' ? 'When?' : 'Which day?'}
          </p>
          {requestType === 'holiday' ? (
            <div className="grid grid-cols-2 gap-3">
              <DateField
                label="From"
                value={startDate}
                min={today}
                onChange={setStartDate}
              />
              <DateField
                label="To"
                value={endDate}
                min={startDate || today}
                onChange={setEndDate}
              />
            </div>
          ) : (
            <DateField
              label="Date"
              value={startDate}
              min={today}
              onChange={setStartDate}
            />
          )}
        </section>

        {/* HALF DAY */}
        {canHalfDay && (
          <section className="bg-slate-50 rounded-2xl p-4">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm font-medium text-slate-800">Half day only</span>
              <SwitchToggle checked={isHalfDay} onChange={setIsHalfDay} />
            </label>
            {isHalfDay && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SegButton
                  active={halfDayType === 'morning'}
                  onClick={() => setHalfDayType('morning')}
                  emoji="🌅" label="Morning"
                />
                <SegButton
                  active={halfDayType === 'afternoon'}
                  onClick={() => setHalfDayType('afternoon')}
                  emoji="🌇" label="Afternoon"
                />
              </div>
            )}
          </section>
        )}

        {/* EARLY FINISH TIME */}
        {requestType === 'early_finish' && (
          <section>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
              What time?
            </p>
            <input
              type="time"
              value={earlyFinishTime}
              onChange={e => setEarlyFinishTime(e.target.value)}
              required
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </section>
        )}

        {/* REASON */}
        <section>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
            Reason <span className="text-slate-400 normal-case font-normal">(optional)</span>
          </p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Family wedding, doctor's appointment, weekend away…"
            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 resize-none focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </section>

        {/* NEXT YEAR BANNER */}
        {requestType === 'holiday' && startDate && !requestIsCurrentYear && (
          <section className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0" aria-hidden>📅</span>
              <div>
                <p className="text-sm font-semibold text-blue-900">Next holiday year ({requestYear?.label})</p>
                <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                  Your current balance won&apos;t change when this is approved — it only counts when next year starts.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* CALC SUMMARY — always visible for holiday type */}
        {requestType === 'holiday' && (
          <section className={`rounded-2xl p-4 transition ${
            !startDate || !endDate
              ? 'bg-slate-50 border border-slate-200'
              : requestIsCurrentYear && balanceAfter < 0
                ? 'bg-red-50 border border-red-200'
                : daysRequested === 0
                  ? 'bg-yellow-50 border border-yellow-200'
                  : 'bg-emerald-50 border border-emerald-200'
          }`}>
            <CalcRow
              label="Working days requested"
              value={!startDate || !endDate ? '—' : String(daysRequested)}
              bold
            />
            {requestIsCurrentYear && (
              <>
                <CalcRow label="Current balance" value={String(balance)} />
                <CalcRow
                  label="Balance after approval"
                  value={!startDate || !endDate ? '—' : String(balanceAfter)}
                  bold
                  valueClass={balanceAfter < 0 ? 'text-red-600' : 'text-emerald-700'}
                  divider
                />
              </>
            )}
            {daysRequested === 0 && startDate && endDate && (
              <p className="text-xs text-yellow-800 mt-3 leading-snug">
                ⚠️ The selected dates don&apos;t include any of your working days
              </p>
            )}
            {requestIsCurrentYear && balanceAfter < 0 && (
              <p className="text-xs text-red-700 mt-3 leading-snug">
                ⚠️ You don&apos;t have enough days available
              </p>
            )}
            <p className="text-xs text-slate-500 mt-3 leading-snug">
              You work {workingDaysCount} days per week. Bank holidays are excluded automatically.
            </p>
          </section>
        )}

        {/* INLINE submit (dashboard variant) */}
        {variant === 'dashboard' && (
          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-2xl transition"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={submitDisabled}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold py-3 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        )}
      </div>

      {/* STICKY submit (employee variant) */}
      {variant === 'employee' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200 p-4 pb-6 z-40 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
          <div className="max-w-md mx-auto flex gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-2xl transition"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={submitDisabled}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold py-3.5 rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

// ─── small helpers ──────────────────────────────────────────────────

function DateField({
  label, value, min, onChange,
}: {
  label: string
  value: string
  min: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 mb-1 block">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        required
        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  )
}

function SwitchToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 items-center rounded-full transition ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block w-5 h-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function SegButton({
  active, onClick, emoji, label,
}: {
  active: boolean
  onClick: () => void
  emoji: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition border ${
        active
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
      }`}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </button>
  )
}

function CalcRow({
  label, value, bold, valueClass, divider,
}: {
  label: string
  value: string
  bold?: boolean
  valueClass?: string
  divider?: boolean
}) {
  return (
    <div className={`flex justify-between text-sm ${divider ? 'mt-1 pt-2 border-t border-slate-200' : 'mt-1 first:mt-0'}`}>
      <span className="text-slate-700">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} text-slate-900 ${valueClass || ''}`}>
        {value}
      </span>
    </div>
  )
}
