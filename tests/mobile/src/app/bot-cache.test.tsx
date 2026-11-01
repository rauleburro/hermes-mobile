import type { RunEvent } from '@hermes-mobile/api';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import BotChatScreen from '@mobile/app/bot/[botId]';
import { BffError, followBotRun, getBotChat, getBotMessages, sendBotMessage } from '@mobile/lib/bff';
import { bindCache, cacheStorage, readChat, writeChat } from '@mobile/lib/cache';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
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

const never = () => new Promise<never>(() => {});

function savedChat() {
  bindCache('http://bff.local:8787');
  writeChat('default', 'chat-default', [
    { role: 'user', content: 'saved question' },
    { role: 'assistant', content: 'saved answer' },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheStorage().clearAll();
  jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-default' });
  jest.mocked(getBotMessages).mockResolvedValue([
    { role: 'user', content: 'fresh question' },
    { role: 'assistant', content: 'fresh answer' },
  ]);
});

describe('BotChatScreen with the local cache', () => {
  it('paints the saved messages immediately, marked as updating', async () => {
    savedChat();
    jest.mocked(getBotChat).mockImplementation(never);
    await render(<BotChatScreen />);

    expect(screen.getByText('saved question')).toBeOnTheScreen();
    expect(screen.getByText('saved answer')).toBeOnTheScreen();
    expect(screen.getByText('Updating…')).toBeOnTheScreen();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('replaces the saved messages with the fresh history and saves it', async () => {
    savedChat();
    jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-new' });
    await render(<BotChatScreen />);

    expect(await screen.findByText('fresh answer')).toBeOnTheScreen();
    expect(screen.queryByText('saved answer')).toBeNull();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(readChat('default')).toMatchObject({
      sessionId: 'chat-new',
      messages: [{ content: 'fresh question' }, { content: 'fresh answer' }],
    });
  });

  it('keeps the saved messages with an offline hint when the refresh fails', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new Error('Network request failed'));
    await render(<BotChatScreen />);

    expect(await screen.findByText(/Offline · showing saved messages/)).toBeOnTheScreen();
    expect(screen.getByText('saved answer')).toBeOnTheScreen();
    expect(readChat('default')?.messages).toHaveLength(2);
  });

  it('only sends once the BFF has answered, never against the saved copy', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new Error('Network request failed'));
    await render(<BotChatScreen />);
    await screen.findByText(/Offline · showing saved messages/);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Message Hermes'), '[e2e] ping');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Send' }));
    expect(sendBotMessage).not.toHaveBeenCalled();
  });

  it('trusts the BFF over the cache when the Bot Chat is gone', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new BffError('409', 409, 'bot_chat_missing'));
    await render(<BotChatScreen />);

    expect(await screen.findByText(/has no Bot Chat yet/)).toBeOnTheScreen();
    expect(screen.queryByText('saved answer')).toBeNull();
    expect(readChat('default')).toBeNull();
  });

  it('saves the history reloaded after a turn', async () => {
    bindCache('http://bff.local:8787');
    jest.mocked(sendBotMessage).mockResolvedValue({ runId: 'run-1', replayed: false });
    jest.mocked(followBotRun).mockImplementation(async (_b, _r, onEvent) => {
      onEvent({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 7' } as RunEvent);
    });
    await render(<BotChatScreen />);
    await screen.findByText('fresh answer');
    jest.mocked(getBotMessages).mockResolvedValue([
      { role: 'user', content: '[e2e] ping' },
      { role: 'assistant', content: 'E2E-OK 7' },
    ]);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Message Hermes'), '[e2e] ping');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(readChat('default')?.messages.at(-1)).toMatchObject({ content: 'E2E-OK 7' }));
  });
});
