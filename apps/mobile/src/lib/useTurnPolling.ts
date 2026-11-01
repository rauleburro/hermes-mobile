import type { SessionMessage } from '@hermes-mobile/api';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getBotChatMessages } from './bff';
import { maxRowId } from './chatItems';

/**
 * Bot Chat runs stream only their final event, so progress comes from the rows Hermes persists
 * while the turn runs (tool calls before they run, each result after). Faster polling is wasted.
 */
export const TURN_POLL_MS = 1500;
/** After this many polls in a row bring nothing new, the interval doubles (up to the max). */
export const TURN_POLL_BACKOFF_AFTER = 10;
export const TURN_POLL_MAX_INTERVAL_MS = 10_000;
/** Backstop: a turn is never polled longer than this, even if its stream never ends. */
export const TURN_POLL_MAX_MS = 10 * 60_000;
/** The latest rows per poll; a turn never adds this many in one interval. Merged by id, so overlap is free. */
const POLL_WINDOW = 100;

const isActive = (state: unknown) => typeof state !== 'string' || state === 'active';

/** Whether the app is in the foreground. Focus alone isn't enough: Android keeps a backgrounded screen focused. */
function useAppActive() {
  const [active, setActive] = useState(() => isActive(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(isActive(state)));
    return () => sub?.remove();
  }, []);
  return active;
}

/**
 * While `active`, the screen is focused and the app is in the foreground, fetches the latest Bot
 * Chat rows and hands them to `onRows`: every {@link TURN_POLL_MS}, backing off while nothing
 * changes. One request at a time; a response that lands after it stopped is dropped. Gives up
 * after {@link TURN_POLL_MAX_MS} of polling and calls `onExpired` once.
 */
export function useTurnPolling(
  botId: string,
  active: boolean,
  onRows: (rows: SessionMessage[]) => void,
  onExpired?: () => void,
) {
  const appActive = useAppActive();
  const callbacks = useRef({ onRows, onExpired });
  useEffect(() => {
    callbacks.current = { onRows, onExpired };
  }, [onRows, onExpired]);

  // Per turn: when polling started, how many polls brought nothing new (or failed), the last
  // signature, and whether polling already ran (a resume then polls at once).
  const fresh = () => ({ startedAt: Date.now(), unchanged: 0, signature: '', expired: false, ran: false });
  const turn = useRef({ startedAt: 0, unchanged: 0, signature: '', expired: false, ran: false });
  useEffect(() => {
    if (active) turn.current = fresh();
  }, [active]);

  useFocusEffect(
    useCallback(() => {
      if (!active || !appActive) return;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const t = turn.current;

      const nextDelay = () =>
        t.unchanged < TURN_POLL_BACKOFF_AFTER
          ? TURN_POLL_MS
          : Math.min(TURN_POLL_MS * 2 ** (t.unchanged - TURN_POLL_BACKOFF_AFTER + 1), TURN_POLL_MAX_INTERVAL_MS);

      const expire = () => {
        if (stopped || t.expired) return;
        t.expired = true;
        callbacks.current.onExpired?.();
      };

      // Fetch first, expire after: a long background stay still gets one look at the Bot Chat,
      // and the turn may end on what it brings.
      const poll = async () => {
        try {
          const rows = await getBotChatMessages(botId, { order: 'latest', limit: POLL_WINDOW });
          if (stopped) return;
          const signature = `${rows.length}:${maxRowId(rows)}`;
          t.unchanged = signature === t.signature ? t.unchanged + 1 : 0;
          t.signature = signature;
          callbacks.current.onRows(rows);
        } catch {
          // A missed poll is harmless (the next one or the end-of-turn reload catches up), but it
          // counts toward the backoff so an unreachable BFF isn't hammered.
          t.unchanged++;
        }
        if (stopped) return;
        // Past the cap: expire on the next tick, after `onRows` had the chance to end the turn.
        timer = Date.now() - t.startedAt >= TURN_POLL_MAX_MS ? setTimeout(expire, 0) : setTimeout(poll, nextDelay());
      };

      if (t.expired) return;
      // The first poll of a turn waits one interval (the turn barely started); a resume after
      // blur or background polls at once, since anything may have happened meanwhile.
      timer = setTimeout(poll, t.ran ? 0 : nextDelay());
      t.ran = true;
      // The cap on its own clock, so a poll that hangs can't hold it off. Already past it (a long
      // pause), the resume poll above gets its look first and expires after it.
      const remaining = TURN_POLL_MAX_MS - (Date.now() - t.startedAt);
      const capTimer = remaining > 0 ? setTimeout(expire, remaining) : undefined;
      return () => {
        stopped = true;
        clearTimeout(timer);
        clearTimeout(capTimer);
      };
    }, [botId, active, appActive]),
  );
}
