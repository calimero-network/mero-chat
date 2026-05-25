import { useEffect, useRef, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

// Online = heartbeat seen within this window. 90s = 3× the 30s poll interval
// so a single missed beat doesn't flip someone offline.
const THRESHOLD_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface UsePresenceResult {
  isOnline: (identity: string) => boolean;
}

/**
 * Registers the local user as online in `contextId` (by calling `heartbeat`
 * every 30 s) and polls `get_presence` to find out who else is online.
 *
 * Returns `isOnline(identity)` — a stable callback that tests membership in
 * the latest online set without triggering re-renders on every poll.
 *
 * Pass `undefined` for either argument to disable the hook (no calls made).
 */
export function usePresence(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): UsePresenceResult {
  // Keep the online set in a ref so `isOnline` is stable across renders.
  const onlineRef = useRef<Set<string>>(new Set());

  const runHeartbeat = useCallback(async () => {
    if (!contextId || !executorPublicKey) return;
    const api = new ClientApiDataSource();
    await api.heartbeat(contextId, executorPublicKey);
  }, [contextId, executorPublicKey]);

  const refreshPresence = useCallback(async () => {
    if (!contextId || !executorPublicKey) return;
    const api = new ClientApiDataSource();
    const resp = await api.getPresence(contextId, executorPublicKey, THRESHOLD_MS);
    if (resp.data) {
      onlineRef.current = new Set(resp.data);
    }
  }, [contextId, executorPublicKey]);

  useEffect(() => {
    if (!contextId || !executorPublicKey) return;

    // Fire immediately on mount, then on the interval.
    void runHeartbeat();
    void refreshPresence();

    const id = setInterval(() => {
      void runHeartbeat();
      void refreshPresence();
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [contextId, executorPublicKey, runHeartbeat, refreshPresence]);

  const isOnline = useCallback(
    (identity: string) => onlineRef.current.has(identity),
    [],
  );

  return { isOnline };
}
