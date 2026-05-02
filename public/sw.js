/**
 * South Lincs Systems — Service Worker
 *
 * Receives Web Push messages and renders native notifications.
 * Handles notification clicks by focusing/opening the relevant URL.
 *
 * Lives at /public/sw.js so it's served from the site root with full
 * scope ('/').
 */

// Update this version to force re-install of the SW (e.g. after fixing
// a bug in this file). Browsers cache the SW aggressively otherwise.
const SW_VERSION = '1'

self.addEventListener('install', (event) => {
  // Activate immediately on install — don't wait for old SW to die.
  // Safe because we don't precache anything that could go stale.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take control of all open clients (tabs) right away.
  event.waitUntil(self.clients.claim())
})

/**
 * Push event — fires when a push message arrives.
 * Payload is JSON: { title, body, url, tone }
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    // Push without JSON payload — show a generic fallback so the
    // notification still appears.
    payload = { title: 'New update', body: 'Open the app to see what changed.' }
  }

  const title = payload.title || 'South Lincs Systems'
  const body = payload.body || ''
  const url = payload.url || '/employee'
  const tone = payload.tone || 'info'

  const options = {
    body,
    icon: '/icon-192.png',         // Optional — falls back to favicon if missing
    badge: '/icon-badge.png',      // Optional — small monochrome badge on Android
    tag: payload.tag || 'sls',     // Same tag = newer push replaces older
    renotify: true,                // Re-alert even if a notification with this tag exists
    requireInteraction: tone === 'urgent', // Critical defects stay until dismissed
    data: { url },
    vibrate: tone === 'urgent' ? [200, 100, 200, 100, 200] : [100, 50, 100],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * Notification click — focus the existing tab if one is open at the
 * target URL, otherwise open a new one.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = (event.notification.data && event.notification.data.url) || '/employee'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find an existing tab matching the target URL prefix
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        const targetPath = targetUrl.startsWith('http') ? new URL(targetUrl).pathname : targetUrl
        if (clientUrl.pathname === targetPath || clientUrl.pathname.startsWith(targetPath)) {
          if ('focus' in client) {
            return client.focus()
          }
        }
      }
      // No matching tab — try to focus any same-origin tab
      for (const client of clientList) {
        if ('focus' in client) {
          // Navigate it to the target URL after focusing
          client.focus()
          if ('navigate' in client) {
            return client.navigate(targetUrl)
          }
          return
        }
      }
      // Last resort — open a new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
