import type { RunEvent, SessionMessage } from '@hermes-mobile/api';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, DeviceEventEmitter, Platform, StyleSheet } from 'react-native';
import BotChatScreen from '@mobile/app/bot/[botId]';
import {
  BffError,
  followBotRun,
  getBotChat,
  getBotChatMessages,
  getBotMessages,
  REQUEST_TIMEOUT_MS,
  sendBotMessage,
  stopBotRun,
} from '@mobile/lib/bff';
import { buildChatItems } from '@mobile/lib/chatItems';
import { placeholderColor } from '@mobile/lib/theme';
import { TURN_POLL_MAX_INTERVAL_MS, TURN_POLL_MAX_MS, TURN_POLL_MS } from '@mobile/lib/useTurnPolling';

let mockTheme = {
  dark: false,
  colors: { text: 'black', border: 'gray', notification: 'red', card: 'white', primary: 'blue', background: 'white' },
};
jest.mock('expo-router', () => ({
  // Render the header's Stop button so tests can press it.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => ({ botId: 'default', name: 'Hermes' }),
  useTheme: () => mockTheme,
  // Always focused here; focus and blur handling is covered by the useTurnPolling tests.
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
// The native header's height, which the composer must clear when the keyboard opens.
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 120 }));
// Each send gets a new id (client-msg-1, -2, …); a resend reuses its message's id.
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `client-msg-${++mockUuid}` }));
// The real builder, spied on, to check the chat isn't rebuilt on every Working tick.
jest.mock('@mobile/lib/chatItems', () => {
  const actual = jest.requireActual('@mobile/lib/chatItems');
  return { ...actual, buildChatItems: jest.fn(actual.buildChatItems) };
});
jest.mock('@mobile/lib/bff', () => {
  const actual = jest.requireActual('@mobile/lib/bff');
  return {
    BffError: actual.BffError,
    REQUEST_TIMEOUT_MS: actual.REQUEST_TIMEOUT_MS,
    getBotChat: jest.fn(),
    getBotMessages: jest.fn(),
    getBotChatMessages: jest.fn(),
    sendBotMessage: jest.fn(),
    followBotRun: jest.fn(),
    stopBotRun: jest.fn(),
  };
});

/** Lets a test decide when the run's terminal event arrives. */
function controllableRun() {
  let finish: (event: RunEvent) => void = () => {};
  jest.mocked(followBotRun).mockImplementation(
    (_bot, _run, onEvent) =>
      new Promise<void>((resolve) => {
        finish = (event) => {
          onEvent(event);
          resolve();
        };
      }),
  );
  return (event: RunEvent) => finish(event);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-default' });
  jest.mocked(getBotMessages).mockResolvedValue([
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'tool', content: '{"tool":"output"}' },
  ]);
  jest.mocked(sendBotMessage).mockResolvedValue({ runId: 'run-1', replayed: false });
  jest.mocked(stopBotRun).mockResolvedValue({});
  jest.mocked(getBotChatMessages).mockResolvedValue([]);
});

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText('Message Hermes'), text);
  await user.press(screen.getByRole('button', { name: 'Send' }));
}

describe('BotChatScreen', () => {
  it("shows the Bot Chat history (user and assistant lines only) from the Bot's profile", async () => {
    await render(<BotChatScreen />);

    expect(await screen.findByText('earlier question')).toBeOnTheScreen();
    expect(screen.getByText('earlier answer')).toBeOnTheScreen();
    expect(screen.queryByText('{"tool":"output"}')).toBeNull();
    expect(getBotMessages).toHaveBeenCalledWith('default', 'chat-default');
  });

  it('renders assistant replies as Markdown and keeps user lines literal', async () => {
    jest.mocked(getBotMessages).mockResolvedValue([
      { id: 1, role: 'user', content: 'Please use **stars**' },
      { id: 2, role: 'assistant', content: 'Sure, **bold** reply' },
    ]);
    await render(<BotChatScreen />);

    expect(await screen.findByText('Please use **stars**')).toBeOnTheScreen();
    expect(screen.getByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });

  it('renders the final reply from run.completed as Markdown', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await screen.findByText(/Working…/);

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: '## Done\n\n**E2E-OK**' });

    expect(await screen.findByRole('header', { name: 'Done' })).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*E2E-OK\*\*/)).toBeNull();
  });

  it('explains a missing Bot Chat and offers no composer', async () => {
    jest.mocked(getBotChat).mockRejectedValue(new BffError('409', 409, 'bot_chat_missing'));
    await render(<BotChatScreen />);

    expect(await screen.findByText(/has no Bot Chat yet/)).toBeOnTheScreen();
    expect(screen.getByText(/Hermes Desktop/)).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText('Message Hermes')).toBeNull();
  });

  it('explains an unreachable Bot', async () => {
    jest.mocked(getBotChat).mockRejectedValue(new BffError('404', 404, 'bot_unreachable'));
    await render(<BotChatScreen />);

    expect(await screen.findByText(/can't reach this Bot/)).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText('Message Hermes')).toBeNull();
  });

  it('sends through the Bot route with a client message id and follows the Bot-scoped run', async () => {
    controllableRun();
    await render(<BotChatScreen />);

    await send('[e2e] ping');

    expect(sendBotMessage).toHaveBeenCalledWith('default', 'client-msg-1', '[e2e] ping');
    await waitFor(() => expect(followBotRun).toHaveBeenCalledWith('default', 'run-1', expect.any(Function), expect.anything()));
    expect(screen.getByText('[e2e] ping')).toBeOnTheScreen();
  });

  it('shows a working state until run.completed, then the reply', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    expect(await screen.findByText(/Working…/)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Message Hermes')).toBeDisabled();

    // History not yet updated when the turn completes: the reply still shows from the event.
    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 42' });

    expect(await screen.findByText('E2E-OK 42')).toBeOnTheScreen();
    expect(screen.queryByText(/Working…/)).toBeNull();
    expect(screen.getByText('[e2e] ping')).toBeOnTheScreen();
  });

  it('reloads the history after the turn and does not duplicate lines it already holds', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await screen.findByText(/Working…/);
    // A Bot Chat only grows: the reload holds the earlier rows plus the new turn.
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: '[e2e] ping' },
      { role: 'assistant', content: 'E2E-OK 42' },
    ]);

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 42' });

    await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Working…/)).toBeNull());
    expect(screen.getAllByText('E2E-OK 42')).toHaveLength(1);
    expect(screen.getAllByText('[e2e] ping')).toHaveLength(1);
  });

  it('shows why a turn failed', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await screen.findByText(/Working…/);

    finish({ event: 'run.failed', run_id: 'run-1', timestamp: 1, error: 'model unavailable' });

    expect(await screen.findByText('Run ended: model unavailable')).toBeOnTheScreen();
  });

  it('stops the run through the Bot-scoped route while it is working', async () => {
    controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Stop' }));

    expect(stopBotRun).toHaveBeenCalledWith('default', 'run-1');
  });

  it('keeps the composer usable and reports a send that the BFF rejected', async () => {
    jest.mocked(sendBotMessage).mockRejectedValue(new BffError('POST failed (409)', 409, 'bot_chat_missing'));
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    expect(await screen.findByText(/Message not sent/)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Message Hermes')).toBeEnabled();
  });

  it('resends a failed message with the same clientMessageId', async () => {
    jest.mocked(sendBotMessage).mockRejectedValueOnce(new Error('network down'));
    controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Resend' }));

    expect(sendBotMessage).toHaveBeenCalledTimes(2);
    expect(jest.mocked(sendBotMessage).mock.calls[1]).toEqual(['default', 'client-msg-1', '[e2e] ping']);
    expect(screen.getAllByText('[e2e] ping')).toHaveLength(1);
  });

  it('does not call a turn failed when it only lost track of the reply, and offers a refresh instead of a resend', async () => {
    jest.mocked(followBotRun).mockRejectedValue(new Error('events failed (502)'));
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    expect(await screen.findByText(/Lost track of the reply/)).toBeOnTheScreen();
    expect(screen.queryByText(/Message not sent/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: '[e2e] ping' },
      { role: 'assistant', content: 'late reply' },
    ]);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('late reply')).toBeOnTheScreen();
    expect(screen.queryByText(/Lost track of the reply/)).toBeNull();
  });

  it('keeps a new reply that repeats an older line until the history really holds it', async () => {
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: 'say OK' },
      { role: 'assistant', content: 'OK' },
    ]);
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('say OK');
    await screen.findByText(/Working…/);

    // The reload still returns the old history: the new turn isn't persisted yet.
    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'OK' });

    await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Working…/)).toBeNull());
    expect(screen.getAllByText('OK')).toHaveLength(2);
    expect(screen.getAllByText('say OK')).toHaveLength(2);
  });

  it('drops pending lines once the history has the new turn, even if the stored text differs slightly', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await screen.findByText(/Working…/);
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: '[e2e] ping' },
      { role: 'assistant', content: 'E2E-OK 42 (stored)' },
    ]);

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 42' });

    expect(await screen.findByText('E2E-OK 42 (stored)')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('E2E-OK 42')).toBeNull());
    expect(screen.getAllByText('[e2e] ping')).toHaveLength(1);
  });

  it('matches the new turn by message id when the history window slides (oldest rows dropped)', async () => {
    jest.mocked(getBotMessages).mockResolvedValue([
      { id: 1, role: 'user', content: 'q1' },
      { id: 2, role: 'assistant', content: 'a1' },
      { id: 3, role: 'user', content: 'q2' },
      { id: 4, role: 'assistant', content: 'a2' },
    ]);
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('q3');
    await screen.findByText(/Working…/);
    // Same row count as before the send: the window dropped the two oldest rows and added the new turn.
    jest.mocked(getBotMessages).mockResolvedValue([
      { id: 3, role: 'user', content: 'q2' },
      { id: 4, role: 'assistant', content: 'a2' },
      { id: 5, role: 'user', content: 'q3' },
      { id: 6, role: 'assistant', content: 'a3' },
    ]);

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'a3' });

    await waitFor(() => expect(screen.queryByText('q1')).toBeNull());
    await waitFor(() => expect(screen.getAllByText('a3')).toHaveLength(1));
    expect(screen.getAllByText('q3')).toHaveLength(1);
  });

  it('drops an unsent message when a different one is sent, so the new turn is not shown twice', async () => {
    jest.mocked(sendBotMessage).mockRejectedValueOnce(new Error('network down'));
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('message A');
    await screen.findByText(/Message not sent/);

    await send('message B');
    await screen.findByText(/Working…/);
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'message B' },
      { role: 'assistant', content: 'reply B' },
    ]);
    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'reply B' });

    await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('reply B')).toHaveLength(1));
    expect(screen.getAllByText('message B')).toHaveLength(1);
    expect(screen.queryByText('message A')).toBeNull();
    expect(screen.queryByText(/Message not sent/)).toBeNull();
  });

  it('clears "Stop requested" once the turn ends', async () => {
    const finish = controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await userEvent.setup().press(await screen.findByRole('button', { name: 'Stop' }));
    await screen.findByText('Stop requested');

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'done anyway' });

    expect(await screen.findByText('done anyway')).toBeOnTheScreen();
    expect(screen.queryByText('Stop requested')).toBeNull();
  });

  it('aborts the stream on unmount without reloading or reporting a failure', async () => {
    let signal: AbortSignal | undefined;
    jest.mocked(followBotRun).mockImplementation((_b, _r, _e, s) => {
      signal = s;
      return new Promise<void>((resolve) => s.addEventListener('abort', () => resolve()));
    });
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await waitFor(() => expect(signal).toBeDefined());

    await screen.unmount();

    expect(signal!.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(getBotMessages).toHaveBeenCalledTimes(1);
  });

  it('renders nothing actionable for an approval request (Bot Chat approvals are not reachable)', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    let emit: (e: RunEvent) => void = () => {};
    jest.mocked(followBotRun).mockImplementation((_b, _r, onEvent) => {
      emit = onEvent;
      return new Promise<void>(() => {});
    });
    await render(<BotChatScreen />);
    await send('[e2e] ping');
    await waitFor(() => expect(followBotRun).toHaveBeenCalled());

    emit({
      event: 'approval.request',
      run_id: 'run-1',
      timestamp: 1,
      kind: 'command',
      prompt_id: 'p1',
      execution_generation: 0,
      command: 'rm -rf /tmp/x',
      choices: ['once', 'deny'],
    });

    await screen.findByText(/Working…/);
    expect(screen.queryByText(/rm -rf/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Allow|Deny/ })).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('shows a generic notice when the Bot Chat cannot be loaded', async () => {
    jest.mocked(getBotChat).mockRejectedValue(new Error('GET /bots/default/chat failed (502)'));
    await render(<BotChatScreen />);

    expect(await screen.findByText('Could not load the Bot Chat: GET /bots/default/chat failed (502)')).toBeOnTheScreen();
  });

  it('says a stop was requested, since Hermes may keep working on the turn', async () => {
    controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('Stop requested')).toBeOnTheScreen();
  });

  it('shows why a stop failed', async () => {
    jest.mocked(stopBotRun).mockRejectedValue(new Error('POST stop failed (502)'));
    controllableRun();
    await render(<BotChatScreen />);
    await send('[e2e] ping');

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('Stop failed: POST stop failed (502)')).toBeOnTheScreen();
  });
});

const clockCall = (id = 'call_a') => ({ id, call_id: id, type: 'function', function: { name: 'clock', arguments: '{"tz":"UTC"}' } });
const earlier: SessionMessage[] = [
  { id: 1, role: 'user', content: 'earlier question' },
  { id: 2, role: 'assistant', content: 'earlier answer', finish_reason: 'stop' },
];
// Hermes stores the user's Bot Chat message as internal_notification: it must stay visible.
const turnUser: SessionMessage = { id: 10, role: 'user', content: '[e2e] time?', display_kind: 'internal_notification' };
const turnCall: SessionMessage = { id: 11, role: 'assistant', content: '', tool_calls: [clockCall()], finish_reason: 'tool_calls' };
const turnResult: SessionMessage = { id: 12, role: 'tool', content: '12:00 UTC', tool_call_id: 'call_a', tool_name: 'clock' };
const turnAnswer: SessionMessage = { id: 13, role: 'assistant', content: 'E2E-TOOL 7', finish_reason: 'stop' };

describe('BotChatScreen tool cards', () => {
  it('renders tool calls from the history as completed cards and hides hidden rows', async () => {
    jest.mocked(getBotMessages).mockResolvedValue([
      { id: 5, role: 'user', content: '[System: scaffold]', display_kind: 'hidden' },
      turnUser,
      turnCall,
      turnResult,
      turnAnswer,
    ]);
    await render(<BotChatScreen />);

    const card = await screen.findByRole('button', { name: 'Tool clock, tz: UTC, done' });
    expect(screen.getByText('tz: UTC')).toBeOnTheScreen();
    expect(screen.getByText('E2E-TOOL 7')).toBeOnTheScreen();
    expect(screen.queryByText('[System: scaffold]')).toBeNull();
    expect(screen.queryByText('12:00 UTC')).toBeNull();

    await userEvent.setup().press(card);
    expect(screen.getByText('12:00 UTC')).toBeOnTheScreen();
  });

  describe('while a turn is pending', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.mocked(getBotMessages).mockResolvedValue(earlier);
    });
    afterEach(() => jest.useRealTimers());

    const poll = () => act(async () => jest.advanceTimersByTime(TURN_POLL_MS));
    async function sendWithTimers(text: string) {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await user.type(await screen.findByPlaceholderText('Message Hermes'), text);
      await user.press(screen.getByRole('button', { name: 'Send' }));
    }

    it('polls the Bot Chat and shows a running card, then done when its result row arrives', async () => {
      controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      expect(getBotChatMessages).not.toHaveBeenCalled();

      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, turnUser, turnCall]);
      await poll();

      expect(getBotChatMessages).toHaveBeenCalledWith('default', { order: 'latest', limit: 100 });
      expect(await screen.findByLabelText('Tool clock, tz: UTC, running')).toBeOnTheScreen();
      expect(screen.getByTestId('tool-spinner')).toBeOnTheScreen();
      expect(screen.getAllByText('[e2e] time?')).toHaveLength(1);
      expect(screen.getByText(/Working…/)).toBeOnTheScreen();

      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, turnUser, turnCall, turnResult]);
      await poll();

      expect(await screen.findByRole('button', { name: 'Tool clock, tz: UTC, done' })).toBeOnTheScreen();
      expect(screen.queryByTestId('tool-spinner')).toBeNull();
      expect(screen.getAllByText('earlier answer')).toHaveLength(1);
    });

    it('stops polling when the run completes', async () => {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      await poll();
      expect(getBotChatMessages).toHaveBeenCalledTimes(1);

      jest.mocked(getBotMessages).mockResolvedValue([...earlier, turnUser, turnCall, turnResult, turnAnswer]);
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-TOOL 7' }));
      await act(async () => jest.advanceTimersByTime(TURN_POLL_MS * 4));

      expect(getBotChatMessages).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Working…/)).toBeNull();
    });

    it('shows the final answer once when the poll sees it before run.completed', async () => {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, turnUser, turnCall, turnResult, turnAnswer]);
      await poll();
      expect(await screen.findByText('E2E-TOOL 7')).toBeOnTheScreen();

      // The end-of-turn reload is slow: the event must not add a second copy meanwhile.
      jest.mocked(getBotMessages).mockReturnValue(new Promise(() => {}));
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-TOOL 7' }));

      expect(screen.getAllByText('E2E-TOOL 7')).toHaveLength(1);
      expect(screen.getAllByText('[e2e] time?')).toHaveLength(1);
    });

    it('does not take interim text next to a tool call for the final answer', async () => {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      jest.mocked(getBotChatMessages).mockResolvedValue([
        ...earlier,
        turnUser,
        { ...turnCall, content: 'Checking the clock.' },
      ]);
      await poll();
      await screen.findByText('Checking the clock.');

      jest.mocked(getBotMessages).mockReturnValue(new Promise(() => {}));
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-TOOL 7' }));

      expect(await screen.findByText('E2E-TOOL 7')).toBeOnTheScreen();
    });

    /** A stream that never ends by itself (half-open connection); it only returns when aborted. */
    function hangingRun(events: RunEvent[] = []) {
      let signal: AbortSignal | undefined;
      jest.mocked(followBotRun).mockImplementation((_b, _r, onEvent, s) => {
        signal = s;
        events.forEach(onEvent);
        return new Promise<void>((resolve) => s.addEventListener('abort', () => resolve()));
      });
      return () => signal;
    }

    it('ends the turn once a poll brings its final answer, even if the stream never ends', async () => {
      const signal = hangingRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, turnUser, turnCall, turnResult, turnAnswer]);
      jest.mocked(getBotMessages).mockResolvedValue([...earlier, turnUser, turnCall, turnResult, turnAnswer]);

      await poll();

      await waitFor(() => expect(screen.queryByText(/Working…/)).toBeNull());
      expect(signal()!.aborted).toBe(true);
      expect(screen.getAllByText('E2E-TOOL 7')).toHaveLength(1);
      expect(screen.getAllByText('[e2e] time?')).toHaveLength(1);
      expect(screen.queryByText(/Lost track/)).toBeNull();
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
      const polls = jest.mocked(getBotChatMessages).mock.calls.length;
      await act(async () => jest.advanceTimersByTime(TURN_POLL_MS * 4));
      expect(getBotChatMessages).toHaveBeenCalledTimes(polls);
    });

    it("never takes an earlier turn's answer for this one (its rows can arrive late after a failed reload)", async () => {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      // The previous turn's rows show up first; this turn's user row is not stored yet.
      jest.mocked(getBotChatMessages).mockResolvedValue([
        ...earlier,
        { id: 7, role: 'user', content: 'older question' },
        { id: 8, role: 'assistant', content: 'older answer', finish_reason: 'stop' },
      ]);
      await poll();
      await screen.findByText('older answer');

      expect(screen.getByText(/Working…/)).toBeOnTheScreen();
      await poll();
      expect(getBotChatMessages).toHaveBeenCalledTimes(2);

      jest.mocked(getBotMessages).mockReturnValue(new Promise(() => {}));
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-TOOL 7' }));
      expect(await screen.findByText('E2E-TOOL 7')).toBeOnTheScreen();
    });

    it.each([
      ['run.completed', { event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'done' }],
      ['run.failed', { event: 'run.failed', run_id: 'run-1', timestamp: 1, error: 'boom' }],
    ] as const)('stops polling on %s even while the stream stays open', async (_name, event) => {
      hangingRun([event as RunEvent]);
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');

      await act(async () => jest.advanceTimersByTime(TURN_POLL_MS * 4));

      expect(getBotChatMessages).not.toHaveBeenCalled();
    });

    it('gives up after the polling cap: ends the turn and offers a refresh', async () => {
      const signal = hangingRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');

      await act(async () => jest.advanceTimersByTime(TURN_POLL_MAX_MS + TURN_POLL_MAX_INTERVAL_MS));

      expect(await screen.findByText(/Lost track of the reply/)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeOnTheScreen();
      expect(screen.queryByText(/Working…/)).toBeNull();
      expect(signal()!.aborted).toBe(true);
    });

    // Turn N as Hermes stored it: its user row is the same text the next turn sends.
    const turnN: SessionMessage[] = [
      { id: 3, role: 'user', content: 'continue', display_kind: 'internal_notification' },
      { id: 4, role: 'assistant', content: 'answer N', finish_reason: 'stop' },
    ];

    /** Turn N completes but its end-of-turn reload fails, leaving the shown rows stale. */
    async function turnWithFailedReload() {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('continue');
      jest.mocked(getBotMessages).mockRejectedValueOnce(new Error('reload failed (502)'));
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'answer N' }));
      expect(await screen.findByText(/Couldn't refresh the Bot Chat/)).toBeOnTheScreen();
    }

    it('says so when the end-of-turn reload fails, and Refresh clears it', async () => {
      await turnWithFailedReload();
      expect(screen.getByText('answer N')).toBeOnTheScreen();
      jest.mocked(getBotMessages).mockResolvedValue([...earlier, ...turnN]);

      await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).press(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => expect(screen.queryByText(/Couldn't refresh the Bot Chat/)).toBeNull());
      expect(screen.getAllByText('answer N')).toHaveLength(1);
    });

    it('reloads with rows on screen (end of turn, Refresh, catch-up before a send) on the default 15 s budget, so a dead BFF fails a send fast', async () => {
      await turnWithFailedReload(); // 1: first load, 2: end-of-turn reload
      jest.mocked(getBotMessages).mockRejectedValue(new Error('still down'));
      await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).press(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(3));
      controllableRun();
      await sendWithTimers('continue');
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(4));

      expect(REQUEST_TIMEOUT_MS).toBe(15_000);
      const short = { timeoutMs: REQUEST_TIMEOUT_MS };
      // Only the first full load keeps getBotMessages' longer history default.
      expect(getBotMessages).toHaveBeenNthCalledWith(1, 'default', 'chat-default');
      expect(getBotMessages).toHaveBeenNthCalledWith(2, 'default', 'chat-default', short);
      expect(getBotMessages).toHaveBeenNthCalledWith(3, 'default', 'chat-default', short);
      expect(getBotMessages).toHaveBeenNthCalledWith(4, 'default', 'chat-default', short);
    });

    it('reloads stale rows before the next turn, so an identical prompt never ends on the previous answer', async () => {
      await turnWithFailedReload();
      jest.mocked(getBotMessages).mockResolvedValue([...earlier, ...turnN]);
      controllableRun();
      await sendWithTimers('continue');
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(3));

      // Turn N+1's user row is not stored yet (Hermes writes it at its first flush): the poll only has turn N.
      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, ...turnN]);
      await poll();
      await poll();

      expect(screen.getByText(/Working…/)).toBeOnTheScreen();
      expect(screen.getAllByText('continue')).toHaveLength(2);
      expect(screen.getAllByText('answer N')).toHaveLength(1);
    });

    it('when the rows are still stale, lets only the stream or the cap end the next turn', async () => {
      await turnWithFailedReload();
      jest.mocked(getBotMessages).mockRejectedValue(new Error('still down'));
      const finish = controllableRun();
      await sendWithTimers('continue');
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(3));

      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, ...turnN]);
      await poll();
      await poll();
      expect(screen.getByText(/Working…/)).toBeOnTheScreen();

      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'answer N+1' }));
      expect(await screen.findByText('answer N+1')).toBeOnTheScreen();
      expect(screen.queryByText(/Working…/)).toBeNull();
    });

    it('treats the rows as stale while the end-of-turn reload is in flight, so an identical prompt sent meanwhile never ends on the previous answer', async () => {
      const finish = controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('continue');
      // Turn N's end-of-turn reload hangs; the composer is free again meanwhile.
      let landReload: (rows: SessionMessage[]) => void = () => {};
      jest.mocked(getBotMessages).mockImplementationOnce(() => new Promise((resolve) => (landReload = resolve)));
      await act(async () => finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'answer N' }));
      await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(/Working…/)).toBeNull();

      jest.mocked(getBotMessages).mockResolvedValue([...earlier, ...turnN]);
      // A stream that only ends on abort: the poll is what could end this turn early.
      const signal = hangingRun();
      await sendWithTimers('continue');
      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, ...turnN]);
      await poll();
      await poll();
      await act(async () => landReload([...earlier, ...turnN]));
      await poll();

      expect(screen.getByText(/Working…/)).toBeOnTheScreen();
      expect(signal()!.aborted).toBe(false);
    });

    it('renders a final reply delivered by the poll as Markdown, and Send works again once the turn ended', async () => {
      hangingRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      const reply: SessionMessage = { id: 13, role: 'assistant', content: '## Done\n\n**E2E-OK**', finish_reason: 'stop' };
      jest.mocked(getBotChatMessages).mockResolvedValue([...earlier, turnUser, reply]);
      jest.mocked(getBotMessages).mockResolvedValue([...earlier, turnUser, reply]);

      await poll();

      expect(await screen.findByRole('header', { name: 'Done' })).toBeOnTheScreen();
      expect(screen.queryByText(/\*\*E2E-OK\*\*/)).toBeNull();
      await waitFor(() => expect(screen.queryByText(/Working…/)).toBeNull());
      await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).type(screen.getByPlaceholderText('Message Hermes'), 'next');
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('does not rebuild the chat items on the once-a-second Working tick', async () => {
      controllableRun();
      await render(<BotChatScreen />);
      await sendWithTimers('[e2e] time?');
      await screen.findByText('Working… 0s');
      const before = jest.mocked(buildChatItems).mock.calls.length;

      await act(async () => jest.advanceTimersByTime(1000));

      expect(screen.getByText('Working… 1s')).toBeOnTheScreen();
      expect(buildChatItems).toHaveBeenCalledTimes(before);
    });
  });
});

describe('BotChatScreen composer', () => {
  it.each([false, true])('themes the placeholder color (dark: %s)', async (dark) => {
    mockTheme = { ...mockTheme, dark };
    await render(<BotChatScreen />);

    expect(await screen.findByPlaceholderText('Message Hermes')).toHaveProp('placeholderTextColor', placeholderColor({ dark }));
  });

  it.each([
    ['ios', 'keyboardWillShow'],
    ['android', 'keyboardDidShow'],
  ] as const)('lifts the composer above the keyboard on %s, counting the header above the screen', async (os, showEvent) => {
    jest.replaceProperty(Platform, 'OS', os);
    await render(<BotChatScreen />);
    await screen.findByPlaceholderText('Message Hermes');
    const chat = screen.getByTestId('bot-chat');
    // The screen sits under a 120 pt header and runs 700 pt down to the bottom of an 820 pt display.
    await fireEvent(chat, 'layout', { persist: () => {}, nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 700 } } });

    // The keyboard's top edge at y=520 on the display hides the screen's bottom 300 pt.
    await act(async () => {
      DeviceEventEmitter.emit(showEvent, {
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { screenX: 0, screenY: 520, width: 400, height: 300 },
      });
    });

    // Android draws edge to edge, so the window no longer resizes for the keyboard: both platforms pad.
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('bot-chat').props.style).paddingBottom).toBe(300));
  });
});
