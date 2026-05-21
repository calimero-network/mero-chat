import { useState, useEffect, useCallback } from "react";
import { getContextIdentity } from "@calimero-network/mero-react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { downloadBlob } from "../api/meroJsClient";

type ProfileEntry = { avatarBlobId?: string };

// ── Module-level caches (shared across all hook instances) ───────────────────

const profilesByContext = new Map<string, Map<string, ProfileEntry>>();
const profileFetchInFlight = new Map<string, Promise<void>>();
const blobUrlByBlobId = new Map<string, string>();
const blobFetchInFlight = new Map<string, Promise<string | undefined>>();

// Global version bump — all mounted hooks subscribe; when this increments they
// re-run their effects and re-fetch profiles from scratch.
let cacheVersion = 0;
const cacheVersionListeners = new Set<() => void>();

function notifyForContext(contextId: string) {
  for (const [key, fns] of pendingListeners) {
    if (key.startsWith(`${contextId}:`)) fns.forEach((fn) => fn());
  }
}

// key: `${contextId}:${identity}` — notified once profiles for a context land
const pendingListeners = new Map<string, Set<() => void>>();

// ── Async helpers ─────────────────────────────────────────────────────────────

async function ensureProfilesLoaded(contextId: string): Promise<void> {
  if (profilesByContext.has(contextId)) return;
  if (profileFetchInFlight.has(contextId)) {
    await profileFetchInFlight.get(contextId)!;
    return;
  }

  const executorKey = getContextIdentity() ?? "";
  if (!executorKey) return; // not authenticated yet — skip

  const api = new ClientApiDataSource();
  const promise = api
    .getProfiles(contextId, executorKey)
    .then((res) => {
      const map = new Map<string, ProfileEntry>();
      for (const p of res.data ?? []) {
        if (p.identity) map.set(p.identity, { avatarBlobId: p.avatar ?? undefined });
      }
      profilesByContext.set(contextId, map);
    })
    .catch(() => {
      /* silent — effect will retry on next version bump or re-mount */
    })
    .finally(() => {
      profileFetchInFlight.delete(contextId);
      notifyForContext(contextId);
    });

  profileFetchInFlight.set(contextId, promise);
  await promise;
}

async function resolveAvatarUrl(
  blobId: string,
  contextId: string,
): Promise<string | undefined> {
  if (blobUrlByBlobId.has(blobId)) return blobUrlByBlobId.get(blobId);
  if (blobFetchInFlight.has(blobId)) return blobFetchInFlight.get(blobId)!;

  const promise = downloadBlob(blobId, contextId)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      blobUrlByBlobId.set(blobId, url);
      return url;
    })
    .catch(() => undefined)
    .finally(() => blobFetchInFlight.delete(blobId));

  blobFetchInFlight.set(blobId, promise);
  return promise;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Returns the object URL for an identity's avatar, or undefined while loading / if none set. */
export function useAvatarUrl(
  identity: string | undefined,
  contextId: string | undefined,
): string | undefined {
  const cacheKey = identity && contextId ? `${contextId}:${identity}` : undefined;

  const [url, setUrl] = useState<string | undefined>(() => {
    if (!identity || !contextId) return undefined;
    const blobId = profilesByContext.get(contextId)?.get(identity)?.avatarBlobId;
    return blobId ? blobUrlByBlobId.get(blobId) : undefined;
  });

  // Mirror the global version so version bumps from invalidateAvatarCache
  // re-run the fetch effect below.
  const [version, setVersion] = useState(cacheVersion);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    cacheVersionListeners.add(bump);
    return () => { cacheVersionListeners.delete(bump); };
  }, []);

  const tryResolve = useCallback(
    (cancelled: { value: boolean }) => {
      if (cancelled.value || !identity || !contextId) return;
      const blobId = profilesByContext.get(contextId)?.get(identity)?.avatarBlobId;
      if (!blobId) {
        setUrl(undefined);
        return;
      }
      if (blobUrlByBlobId.has(blobId)) {
        setUrl(blobUrlByBlobId.get(blobId));
        return;
      }
      resolveAvatarUrl(blobId, contextId).then((resolved) => {
        if (!cancelled.value) setUrl(resolved ?? undefined);
      });
    },
    [identity, contextId],
  );

  useEffect(() => {
    if (!identity || !contextId || !cacheKey) return;

    const cancelled = { value: false };

    const listener = () => tryResolve(cancelled);
    if (!pendingListeners.has(cacheKey)) pendingListeners.set(cacheKey, new Set());
    pendingListeners.get(cacheKey)!.add(listener);

    ensureProfilesLoaded(contextId).then(() => tryResolve(cancelled));

    return () => {
      cancelled.value = true;
      pendingListeners.get(cacheKey)?.delete(listener);
    };
    // version is intentionally included: a cache invalidation bumps this and
    // forces the effect to re-run + re-fetch profiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, contextId, cacheKey, version]);

  return url;
}

// ── Cache control ─────────────────────────────────────────────────────────────

/** Evict cached profiles and notify all mounted hooks to re-fetch.
 *  Call after the local user updates their own avatar. */
export function invalidateAvatarCache() {
  profilesByContext.clear();
  blobUrlByBlobId.clear();
  cacheVersion++;
  cacheVersionListeners.forEach((fn) => fn());
}
