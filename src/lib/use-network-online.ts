import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

// The browser can know it is offline before a socket heartbeat times out.
// Use both signals; neither an old query snapshot nor an open socket proves
// that an HTTP write can reach the server right now.
export function useNetworkOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
