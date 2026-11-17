/**
 * @module state/offlineStatus
 * Verifies genuine Service Worker activation and scoped cache readiness
 * before displaying the PWA "Offline Ready" indicator.
 */

/**
 * Computes the deterministic Cache Storage key prefix scoped to the registration pathname.
 *
 * @param scopeUrl - Service Worker registration scope URL.
 * @returns Scoped prefix matching `vite.config.ts` generated `sw.js`.
 */
export function buildScopedCachePrefix(scopeUrl: string): string {
  try {
    return `bg02-studio:${new URL(scopeUrl).pathname}:`;
  } catch {
    return "bg02-studio:default:";
  }
}

/** Minimal CacheStorage-like subset needed to test offline precache verification in browser or Vitest. */
export interface CacheStorageLike {
  /** Lists all stored CacheStorage bucket keys on the current origin. */
  keys(): Promise<ReadonlyArray<string>>;
  /** Opens a specific cache bucket by name. */
  open(cacheName: string): Promise<{
    /** Looks up a cached Response matching `request`. */
    match(request: string): Promise<unknown>;
  }>;
}

/** Minimal ServiceWorkerRegistration-like subset used for readiness verification. */
export interface SwRegistrationLike {
  /** Registration scope URL bounding what pages this Service Worker controls. */
  readonly scope: string;
  /** Currently activated worker instance, or `null`. */
  readonly active?: {
    /** Lifecycle state string (e.g., `"activated"`). */
    readonly state?: string;
  } | null;
}

/**
 * Confirms both that the Service Worker is activated/ready AND that a cache matching its exact
 * scope holds the entry shell HTML (`./index.html`), preventing false-positive offline badges
 * when precaching failed or a sibling app occupies the same origin.
 *
 * @param registration - Active Service Worker registration.
 * @param cachesApi - Browser `window.caches` storage interface.
 * @param hasController - Whether `navigator.serviceWorker.controller` currently controls this page.
 * @returns `true` only when offline launch from the scoped cache is verified ready.
 */
export async function verifyScopedServiceWorkerReady(
  registration: SwRegistrationLike | null | undefined,
  cachesApi: CacheStorageLike | undefined,
  hasController: boolean
): Promise<boolean> {
  if (!registration || !cachesApi) {
    return false;
  }

  if (registration.active?.state !== "activated" && !hasController) {
    return false;
  }

  try {
    const prefix = buildScopedCachePrefix(registration.scope);
    const cacheNames = await cachesApi.keys();
    const matchingBuckets = cacheNames.filter((name) => name.startsWith(prefix));
    if (matchingBuckets.length === 0) {
      return false;
    }

    const indexUrl = new URL("./index.html", registration.scope).toString();
    for (const bucketName of matchingBuckets) {
      const cache = await cachesApi.open(bucketName);
      const hit = (await cache.match(indexUrl)) ?? (await cache.match("./index.html"));
      if (hit) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
