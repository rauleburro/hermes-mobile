import type { RunEvent } from '@hermes-mobile/api';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import BotChatScreen from '@mobile/app/bot/[botId]';
import { BffError, followBotRun, getBotChat, getBotMessages, sendBotMessage, stopBotRun } from '@mobile/lib/bff';

jest.mock('expo-router', () => ({
  // Render the header's Stop button so tests can press it.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => ({ botId: 'default', name: 'Hermes' }),
  useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red', card: 'white', primary: 'blue' } }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'client-msg-1' }));
jest.mock('@mobile/lib/bff', () => {
  const actual = jest.requireActual('@mobile/lib/bff');
  return {
    BffError: actual.BffError,
    getBotChat: jest.fn(),
    getBotMessages: jest.fn(),
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
  jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-default' });
  jest.mocked(getBotMessages).mockResolvedValue([
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'tool', content: '{"tool":"output"}' },
  ]);
  jest.mocked(sendBotMessage).mockResolvedValue({ runId: 'run-1', replayed: false });
  jest.mocked(stopBotRun).mockResolvedValue({});
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

    emit({ event: 'approval.request', run_id: 'run-1', timestamp: 1, command: 'rm -rf /tmp/x', choices: ['once', 'deny'] });

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
