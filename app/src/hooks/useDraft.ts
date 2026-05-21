import { useCallback, useEffect, useRef, useState } from "react";
import { getContextId, getContextIdentity } from "@calimero-network/mero-react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

const DEBOUNCE_MS = 4_000;

/**
 * Manages a per-channel message draft backed by WASM storage.
 *
 * - Loads the persisted draft whenever `channelName` changes.
 * - Debounces saves: calling `setDraft` queues a WASM write 4s after the
 *   last keystroke.
 * - Deletes the WASM draft when `clearDraft` is called (on send or empty).
 */
export function useDraft(channelName: string | undefined): {
  draft: string;
  hasDraft: boolean;
  setDraft: (text: string) => void;
  clearDraft: () => void;
} {
  const [draft, setDraftState] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef(channelName);
  channelRef.current = channelName;

  // Load draft when channel changes.
  useEffect(() => {
    if (!channelName) {
      setDraftState("");
      return;
    }
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    if (!contextId || !executorPublicKey) {
      setDraftState("");
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await new ClientApiDataSource().getDraft(contextId, executorPublicKey, channelName);
      if (cancelled) return;
      setDraftState(res.data ?? "");
    })();

    return () => {
      cancelled = true;
      // Flush any pending save for the channel we're leaving.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [channelName]);

  const persistDraft = useCallback((channel: string, text: string) => {
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    if (!contextId || !executorPublicKey) return;
    void new ClientApiDataSource().saveDraft(contextId, executorPublicKey, channel, text);
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!channelRef.current) return;
      const channel = channelRef.current;

      if (!text) {
        // Clear immediately when field is emptied.
        const contextId = getContextId();
        const executorPublicKey = getContextIdentity();
        if (contextId && executorPublicKey) {
          void new ClientApiDataSource().deleteDraft(contextId, executorPublicKey, channel);
        }
        return;
      }

      debounceRef.current = setTimeout(() => {
        persistDraft(channel, text);
      }, DEBOUNCE_MS);
    },
    [persistDraft],
  );

  const clearDraft = useCallback(() => {
    setDraftState("");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    const channel = channelRef.current;
    if (!contextId || !executorPublicKey || !channel) return;
    void new ClientApiDataSource().deleteDraft(contextId, executorPublicKey, channel);
  }, []);

  return { draft, hasDraft: draft.length > 0, setDraft, clearDraft };
}
