'use client'
/**
 * Reusable sound-notifications on/off toggle. Reads/writes the same
 * localStorage key the NotificationProvider uses, so changes take
 * effect immediately for in-app notifications.
 *
 * Two visual variants:
 *   • 'card' — full white card with title + description (admin profile)
 *   • 'inline' — compact white row (employee profile, sits in the
 *      profile page rhythm next to the change-password section)
 */
import { useSoundPreference } from './NotificationProvider'

type Variant = 'card' | 'inline'

export default function SoundToggle({ variant = 'card' }: { variant?: Variant }) {
  const { enabled, setEnabled } = useSoundPreference()

  if (variant === 'inline') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            🔔 Sound notifications
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Play a chime when something new arrives.
          </p>
        </div>
        <Switch enabled={enabled} onChange={setEnabled} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            🔔 Sound notifications
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Play a chime when a holiday request, defect, or assignment comes in.
            Stored on this device only.
          </p>
        </div>
        <Switch enabled={enabled} onChange={setEnabled} />
      </div>
    </div>
  )
}

function Switch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition flex-shrink-0 ${
        enabled ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
