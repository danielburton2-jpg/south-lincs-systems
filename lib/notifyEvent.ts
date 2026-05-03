/**
 * lib/notifyEvent.ts
 *
 * Client-side helper for triggering a push notification after an action.
 * Called from pages after they do their supabase writes.
 *
 * Fail-silent on purpose — the action that triggered it (e.g. defect
 * assignment) has already succeeded by the time we get here. A failed
 * push should not surface as a user-facing error.
 *
 * Example usage:
 *   await supabase.from('vehicle_defects').update({ assigned_to: id }).eq('id', d)
 *   await notifyEvent({ kind: 'defect_assigned', defect_id: d })
 *
 * For messages, the wiring lives inside MessageComposer — see
 * components/messaging/MessageComposer.tsx.
 */

type Event =
  | { kind: 'defect_assigned';   defect_id: string }
  | { kind: 'service_assigned';  schedule_id: string }
  | { kind: 'holiday_decided';   request_id: string }
  | { kind: 'schedule_assigned'; assignment_id: string }
  | { kind: 'message_sent';      message_id: string }

export async function notifyEvent(event: Event): Promise<void> {
  try {
    await fetch('/api/notify-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch (err) {
    console.warn('[notifyEvent] failed (non-fatal):', err)
  }
}
