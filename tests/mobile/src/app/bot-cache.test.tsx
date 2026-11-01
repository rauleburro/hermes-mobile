import type { BotChatResponse, RunEvent } from '@hermes-mobile/api';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import BotChatScreen from '@mobile/app/bot/[botId]';
import { BffError, followBotRun, getBotChat, getBotMessages, sendBotMessage } from '@mobile/lib/bff';
import { bindCache, cacheStorage, readChat, writeChat } from '@mobile/lib/cache';
import { loadConfig, pairedUrl } from '@mobile/lib/config';

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
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn(), pairedUrl: jest.fn() }));

const BFF = 'http://bff.local:8787';
const OTHER = 'http://other.local:8787';
const never = () => new Promise<never>(() => {});

function savedChat(owner = BFF) {
  bindCache(owner);
  writeChat(owner, 'default', 'chat-default', [
    { id: 1, role: 'user', content: 'saved question' },
    { id: 2, role: 'assistant', content: 'saved answer' },
  ]);
}

/** Captures the screen's AppState listener so a test can bring the app back to the foreground. */
function appStateListener() {
  let listener: (s: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
    listener = l as (s: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
  return (s: AppStateStatus) => act(async () => listener(s));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  cacheStorage().clearAll();
  jest.mocked(loadConfig).mockResolvedValue({ url: BFF, token: 'secret' });
  jest.mocked(pairedUrl).mockReturnValue(BFF);
  jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-default' });
  jest.mocked(getBotMessages).mockResolvedValue([
    { id: 1, role: 'user', content: 'fresh question' },
    { id: 2, role: 'assistant', content: 'fresh answer' },
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

  it('renders saved assistant replies as Markdown and keeps saved user lines literal, like the live chat', async () => {
    bindCache(BFF);
    writeChat(BFF, 'default', 'chat-default', [
      { id: 1, role: 'user', content: 'Please use **stars**' },
      { id: 2, role: 'assistant', content: 'Sure, **bold** reply' },
    ]);
    jest.mocked(getBotChat).mockImplementation(never);
    await render(<BotChatScreen />);

    expect(screen.getByText('Updating…')).toBeOnTheScreen();
    expect(screen.getByText('Please use **stars**')).toBeOnTheScreen();
    expect(screen.getByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });

  it('never paints a saved chat that belongs to another BFF than the paired one', async () => {
    savedChat(OTHER);
    jest.mocked(getBotChat).mockImplementation(never);
    await render(<BotChatScreen />);

    expect(screen.queryByText('saved answer')).toBeNull();
    expect(screen.getByText('Loading…')).toBeOnTheScreen();
  });

  it('replaces the saved messages with the fresh history and saves it', async () => {
    savedChat();
    jest.mocked(getBotChat).mockResolvedValue({ botId: 'default', sessionId: 'chat-new' });
    await render(<BotChatScreen />);

    expect(await screen.findByText('fresh answer')).toBeOnTheScreen();
    expect(screen.queryByText('saved answer')).toBeNull();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(readChat(BFF, 'default')).toMatchObject({
      sessionId: 'chat-new',
      messages: [{ content: 'fresh question' }, { content: 'fresh answer' }],
    });
  });

  it("never saves a history that lands after re-pairing into the new BFF's cache", async () => {
    bindCache(BFF);
    let answer: (r: BotChatResponse) => void = () => {};
    jest.mocked(getBotChat).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await render(<BotChatScreen />);
    await waitFor(() => expect(getBotChat).toHaveBeenCalled());
    bindCache(OTHER); // Paired with another BFF while the first one's Bot Chat is loading.

    await act(async () => answer({ botId: 'default', sessionId: 'chat-default' }));

    expect(await screen.findByText('fresh answer')).toBeOnTheScreen();
    expect(readChat(OTHER, 'default')).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual(['meta']);
  });

  it('keeps the saved messages with an offline hint when the BFF cannot be reached', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new TypeError('Network request failed'));
    await render(<BotChatScreen />);

    expect(await screen.findByText('Offline · showing saved messages')).toBeOnTheScreen();
    expect(screen.getByText('saved answer')).toBeOnTheScreen();
    expect(readChat(BFF, 'default')?.messages).toHaveLength(2);
  });

  it("shows the BFF's error, not 'Offline', next to the saved messages when the BFF answered with one", async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new BffError('GET /bots/default/chat failed (401)', 401));
    await render(<BotChatScreen />);

    expect(await screen.findByText('GET /bots/default/chat failed (401) · showing saved messages')).toBeOnTheScreen();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('only sends once the BFF has answered, never against the saved copy', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new TypeError('Network request failed'));
    await render(<BotChatScreen />);
    await screen.findByText(/Offline · showing saved messages/);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Message Hermes'), '[e2e] ping');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Send' }));
    expect(sendBotMessage).not.toHaveBeenCalled();
  });

  it('retries from the offline hint and re-enables Send once the BFF is back', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValueOnce(new TypeError('Network request failed'));
    await render(<BotChatScreen />);
    await screen.findByText('Offline · showing saved messages');

    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('fresh answer')).toBeOnTheScreen();
    expect(screen.queryByText(/showing saved messages/)).toBeNull();
    await user.type(screen.getByPlaceholderText('Message Hermes'), '[e2e] ping');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('retries when the app comes back to the foreground while showing the saved copy', async () => {
    const setAppState = appStateListener();
    savedChat();
    jest.mocked(getBotChat).mockRejectedValueOnce(new TypeError('Network request failed'));
    await render(<BotChatScreen />);
    await screen.findByText('Offline · showing saved messages');

    await setAppState('active');

    expect(await screen.findByText('fresh answer')).toBeOnTheScreen();
    expect(screen.queryByText(/showing saved messages/)).toBeNull();
  });

  it('does not reload on foreground when the history is already fresh', async () => {
    const setAppState = appStateListener();
    await render(<BotChatScreen />);
    await screen.findByText('fresh answer');

    await setAppState('active');

    expect(getBotChat).toHaveBeenCalledTimes(1);
  });

  it('trusts the BFF over the cache when the Bot Chat is gone', async () => {
    savedChat();
    jest.mocked(getBotChat).mockRejectedValue(new BffError('409', 409, 'bot_chat_missing'));
    await render(<BotChatScreen />);

    expect(await screen.findByText(/has no Bot Chat yet/)).toBeOnTheScreen();
    expect(screen.queryByText('saved answer')).toBeNull();
    expect(readChat(BFF, 'default')).toBeNull();
  });

  it('saves the history reloaded after a turn', async () => {
    bindCache(BFF);
    jest.mocked(sendBotMessage).mockResolvedValue({ runId: 'run-1', replayed: false });
    jest.mocked(followBotRun).mockImplementation(async (_b, _r, onEvent) => {
      onEvent({ event: 'run.completed', run_id: 'run-1', timestamp: 1, output: 'E2E-OK 7' } as RunEvent);
    });
    await render(<BotChatScreen />);
    await screen.findByText('fresh answer');
    jest.mocked(getBotMessages).mockResolvedValue([
      { id: 3, role: 'user', content: '[e2e] ping' },
      { id: 4, role: 'assistant', content: 'E2E-OK 7' },
    ]);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Message Hermes'), '[e2e] ping');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(readChat(BFF, 'default')?.messages.at(-1)).toMatchObject({ content: 'E2E-OK 7' }));
  });
});
