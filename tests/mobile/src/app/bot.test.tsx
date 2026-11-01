import type { RunEvent } from '@hermes-mobile/api';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
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
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: '[e2e] ping' },
      { role: 'assistant', content: 'E2E-OK 42' },
    ]);

    finish({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 42' });

    await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('earlier answer')).toBeNull());
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

    expect(await screen.findByText(/Message failed/)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Message Hermes')).toBeEnabled();
  });
});
