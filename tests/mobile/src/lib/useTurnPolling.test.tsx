import type { SessionMessage } from '@hermes-mobile/api';
import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getBotChatMessages } from '@mobile/lib/bff';
import {
  TURN_POLL_BACKOFF_AFTER,
  TURN_POLL_MAX_INTERVAL_MS,
  TURN_POLL_MAX_MS,
  TURN_POLL_MS,
  useTurnPolling,
} from '@mobile/lib/useTurnPolling';

// A controllable focus: the hook's effect runs while focused; blur() runs its cleanup.
const focus: { blur: () => void; refocus: () => void } = { blur: () => {}, refocus: () => {} };
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const [focused, setFocused] = React.useState(true);
      focus.blur = () => setFocused(false);
      focus.refocus = () => setFocused(true);
      React.useEffect(() => (focused ? effect() : undefined), [focused, effect]);
    },
  };
});
jest.mock('@mobile/lib/bff', () => ({ getBotChatMessages: jest.fn() }));

const rows: SessionMessage[] = [{ id: 1, role: 'user', content: 'hi' }];

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(getBotChatMessages).mockReset().mockResolvedValue(rows);
});
afterEach(() => jest.useRealTimers());

const tick = (ms = TURN_POLL_MS) => act(async () => jest.advanceTimersByTime(ms));

describe('useTurnPolling', () => {
  it('polls the latest window of the Bot Chat every ~1.5 s while active and hands over the rows', async () => {
    const onRows = jest.fn();
    await renderHook(() => useTurnPolling('researcher', true, onRows));

    expect(TURN_POLL_MS).toBe(1500);
    await tick(TURN_POLL_MS - 1);
    expect(getBotChatMessages).not.toHaveBeenCalled();
    await tick(1);
    expect(getBotChatMessages).toHaveBeenCalledWith('researcher', { order: 'latest', limit: 100 });
    expect(onRows).toHaveBeenCalledWith(rows);
    await tick();
    expect(getBotChatMessages).toHaveBeenCalledTimes(2);
  });

  it('does not poll while inactive and stops when it turns inactive', async () => {
    const onRows = jest.fn();
    const { rerender } = await renderHook(({ active }: { active: boolean }) => useTurnPolling('default', active, onRows), {
      initialProps: { active: false },
    });
    await tick(TURN_POLL_MS * 3);
    expect(getBotChatMessages).not.toHaveBeenCalled();

    await rerender({ active: true });
    await tick();
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await rerender({ active: false });
    await tick(TURN_POLL_MS * 3);
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);
  });

  it('never overlaps requests: the next poll waits for the previous one', async () => {
    let resolve: (r: SessionMessage[]) => void = () => {};
    jest.mocked(getBotChatMessages).mockImplementation(() => new Promise((r) => (resolve = r)));
    await renderHook(() => useTurnPolling('default', true, jest.fn()));

    await tick();
    await tick(TURN_POLL_MS * 4);
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await act(async () => resolve(rows));
    await tick();
    expect(getBotChatMessages).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount and drops a response that lands afterwards', async () => {
    let resolve: (r: SessionMessage[]) => void = () => {};
    jest.mocked(getBotChatMessages).mockImplementation(() => new Promise((r) => (resolve = r)));
    const onRows = jest.fn();
    const { unmount } = await renderHook(() => useTurnPolling('default', true, onRows));
    await tick();

    await act(async () => unmount());
    await act(async () => resolve(rows));
    await tick(TURN_POLL_MS * 3);

    expect(onRows).not.toHaveBeenCalled();
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);
  });

  it('pauses while the screen is blurred and polls at once on refocus', async () => {
    await renderHook(() => useTurnPolling('default', true, jest.fn()));
    await tick();
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await act(async () => focus.blur());
    await tick(TURN_POLL_MS * 3);
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await act(async () => focus.refocus());
    await tick(0);
    expect(getBotChatMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a failed request', async () => {
    jest.mocked(getBotChatMessages).mockRejectedValueOnce(new Error('offline'));
    const onRows = jest.fn();
    await renderHook(() => useTurnPolling('default', true, onRows));

    await tick();
    expect(onRows).not.toHaveBeenCalled();
    await tick();
    expect(onRows).toHaveBeenCalledWith(rows);
  });

  const appStateListener = () =>
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1] as (s: AppStateStatus) => void;

  it('pauses while the app is not active and polls at once when it is again', async () => {
    await renderHook(() => useTurnPolling('default', true, jest.fn()));
    await tick();
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener()('background'));
    await tick(TURN_POLL_MS * 5);
    expect(getBotChatMessages).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener()('active'));
    await tick(0);
    expect(getBotChatMessages).toHaveBeenCalledTimes(2);
  });

  /** Advances to just before `ms`, checks no poll ran, then to `ms`, checks exactly one did. */
  async function expectNextPollAfter(ms: number) {
    const before = jest.mocked(getBotChatMessages).mock.calls.length;
    await tick(ms - 1);
    expect(getBotChatMessages).toHaveBeenCalledTimes(before);
    await tick(1);
    expect(getBotChatMessages).toHaveBeenCalledTimes(before + 1);
  }

  it('doubles the interval after unchanged polls up to a 10 s ceiling, and resets once rows change', async () => {
    await renderHook(() => useTurnPolling('default', true, jest.fn()));
    // The first poll brings rows; the next TURN_POLL_BACKOFF_AFTER bring nothing new.
    for (let i = 0; i < TURN_POLL_BACKOFF_AFTER + 1; i++) await expectNextPollAfter(TURN_POLL_MS);

    await expectNextPollAfter(TURN_POLL_MS * 2);
    await expectNextPollAfter(TURN_POLL_MS * 4);
    await expectNextPollAfter(TURN_POLL_MAX_INTERVAL_MS);
    await expectNextPollAfter(TURN_POLL_MAX_INTERVAL_MS);

    // A new row arrives: back to the base cadence.
    jest.mocked(getBotChatMessages).mockResolvedValue([...rows, { id: 2, role: 'assistant', content: 'x' }]);
    await expectNextPollAfter(TURN_POLL_MAX_INTERVAL_MS);
    await expectNextPollAfter(TURN_POLL_MS);
  });

  it('counts failed polls toward the backoff', async () => {
    jest.mocked(getBotChatMessages).mockRejectedValue(new Error('offline'));
    await renderHook(() => useTurnPolling('default', true, jest.fn()));
    for (let i = 0; i < TURN_POLL_BACKOFF_AFTER; i++) await expectNextPollAfter(TURN_POLL_MS);

    await expectNextPollAfter(TURN_POLL_MS * 2);
  });

  it('gives up after the hard cap and reports it, even if the turn never ends', async () => {
    const onExpired = jest.fn();
    await renderHook(() => useTurnPolling('default', true, jest.fn(), onExpired));

    await tick(TURN_POLL_MAX_MS + TURN_POLL_MAX_INTERVAL_MS);
    // Expiry lands one tick after the last poll, once that poll's rows were handled.
    await tick(0);
    const calls = jest.mocked(getBotChatMessages).mock.calls.length;
    expect(onExpired).toHaveBeenCalledTimes(1);

    await tick(TURN_POLL_MAX_MS);
    expect(getBotChatMessages).toHaveBeenCalledTimes(calls);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('after a long background stay, polls once more before giving up', async () => {
    const onRows = jest.fn();
    const onExpired = jest.fn();
    await renderHook(() => useTurnPolling('default', true, onRows, onExpired));
    await act(async () => appStateListener()('background'));
    await tick(TURN_POLL_MAX_MS + 60_000);
    expect(getBotChatMessages).not.toHaveBeenCalled();

    await act(async () => appStateListener()('active'));
    await tick(0);
    await tick(0);

    expect(getBotChatMessages).toHaveBeenCalledTimes(1);
    expect(onRows).toHaveBeenCalledWith(rows);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('does not report expiry when that last poll ended the turn', async () => {
    const onExpired = jest.fn();
    await renderHook(() => {
      const [active, setActive] = useState(true);
      useTurnPolling('default', active, () => setActive(false), onExpired);
    });
    await act(async () => appStateListener()('background'));
    await tick(TURN_POLL_MAX_MS + 60_000);

    await act(async () => appStateListener()('active'));
    await tick(0);
    await tick(0);

    expect(getBotChatMessages).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
});
