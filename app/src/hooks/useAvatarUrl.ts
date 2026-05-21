import { useState, useEffect } from "react";
import {
  getContextIdentity,
} from "@calimero-network/mero-react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { downloadBlob } from "../api/meroJsClient";

type ProfileEntry = { avatarBlobId?: string };

// Module-level caches survive re-renders and are shared across all hook instances.
const profilesByContext = new Map<string, Map<string, ProfileEntry>>();
const profileFetchInFlight = new Map<string, Promise<void>>();
const blobUrlByBlobId = new Map<string, string>();
const blobFetchInFlight = new Map<string, Promise<string | undefined>>();
// key: `${contextId}:${identity}` → listeners to notify when URL becomes available
const pendingListeners = new Map<string, Set<() => void>>();

function notifyForContext(contextId: string) {
  for (const [key, fns] of pendingListeners) {
    if (key.startsWith(`${contextId}:`)) fns.forEach((fn) => fn());
  }
}

async function ensureProfilesLoaded(contextId: string): Promise<void> {
  if (profilesByContext.has(contextId)) return;
  if (profileFetchInFlight.has(contextId)) {
    await profileFetchInFlight.get(contextId)!;
    return;
  }
  const executorKey = getContextIdentity() ?? "";
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
      // On error leave the cache empty so we don't retry spam, but remove
      // the in-flight entry so it can be retried later.
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

/** Returns the object URL for an identity's avatar, or undefined while loading / if none set. */
export function useAvatarUrl(
  identity: string | undefined,
  contextId: string | undefined,
): string | undefined {
  const cacheKey =
    identity && contextId ? `${contextId}:${identity}` : undefined;

  const [url, setUrl] = useState<string | undefined>(() => {
    if (!identity || !contextId) return undefined;
    const blobId = profilesByContext.get(contextId)?.get(identity)?.avatarBlobId;
    return blobId ? blobUrlByBlobId.get(blobId) : undefined;
  });

  useEffect(() => {
    if (!identity || !contextId || !cacheKey) return;

    let cancelled = false;

    const tryResolve = () => {
      if (cancelled) return;
      const blobId = profilesByContext.get(contextId)?.get(identity)?.avatarBlobId;
      if (!blobId) return;
      if (blobUrlByBlobId.has(blobId)) {
        setUrl(blobUrlByBlobId.get(blobId));
        return;
      }
      resolveAvatarUrl(blobId, contextId).then((resolved) => {
        if (!cancelled) setUrl(resolved ?? undefined);
      });
    };

    if (!pendingListeners.has(cacheKey)) pendingListeners.set(cacheKey, new Set());
    pendingListeners.get(cacheKey)!.add(tryResolve);

    ensureProfilesLoaded(contextId).then(tryResolve);

    return () => {
      cancelled = true;
      pendingListeners.get(cacheKey)?.delete(tryResolve);
    };
  }, [identity, contextId, cacheKey]);

  return url;
}

/** Evict all cached profiles for a context so the next load re-fetches fresh data.
 *  Call after the local user updates their own avatar. */
export function invalidateAvatarCache(contextId?: string) {
  if (contextId) {
    profilesByContext.delete(contextId);
  } else {
    profilesByContext.clear();
    blobUrlByBlobId.clear();
  }
}
