import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'metaswap:chunk-reload'

/** True for the errors a browser raises when a lazily loaded page chunk cannot be fetched. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed/i.test(msg)
}

/** Reload the page once (per tab session) to pick up a fresh index.html after an update. Returns false if already tried. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * `React.lazy` that survives a flaky first load: it retries the dynamic import a few times, and if the
 * chunk is really gone (a stale tab after a redeploy) it reloads the page once instead of crashing.
 */
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await load()
        try {
          sessionStorage.removeItem(RELOAD_KEY)
        } catch {
          /* storage unavailable */
        }
        return mod
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
    if (isChunkLoadError(lastErr) && reloadOnce()) return new Promise<never>(() => {}) // page is reloading
    throw lastErr
  })
}
