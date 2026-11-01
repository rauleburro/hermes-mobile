import type { BotSummary, BotsResponse } from '@hermes-mobile/api';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import HomeScreen from '@mobile/app/index';
import { BffError, getBotChat, getBotMessages, listBots } from '@mobile/lib/bff';
import { bindCache, cacheStorage, readRoster, writeRoster } from '@mobile/lib/cache';
import { loadConfig } from '@mobile/lib/config';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn() },
    Stack: { Screen: () => null },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red', card: 'white', primary: 'blue' } }),
  };
});
jest.mock('@mobile/lib/bff', () => {
  const actual = jest.requireActual('@mobile/lib/bff');
  return { BffError: actual.BffError, listBots: jest.fn(), getBotChat: jest.fn(), getBotMessages: jest.fn() };
});
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn() }));

const bot = (over: Partial<BotSummary>): BotSummary => ({
  id: 'default',
  name: 'Hermes',
  title: null,
  description: null,
  reachable: true,
  ...over,
});

function roster(bots: BotSummary[], botModeEnabled = true) {
  jest.mocked(listBots).mockResolvedValue({ botModeEnabled, bots } satisfies BotsResponse);
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheStorage().clearAll();
  jest.mocked(loadConfig).mockResolvedValue({ url: 'http://bff.local:8787', token: 'secret' });
  jest.mocked(getBotChat).mockImplementation(async (botId) => ({ botId, sessionId: `chat-${botId}` }));
  jest.mocked(getBotMessages).mockResolvedValue([]);
});

describe('HomeScreen (Bots roster)', () => {
  it('sends an unpaired app to the pair screen', async () => {
    jest.mocked(loadConfig).mockResolvedValue(null);
    await render(<HomeScreen />);

    expect(router.push).toHaveBeenCalledWith('/pair');
    expect(listBots).not.toHaveBeenCalled();
  });

  it('lists every Bot with initials, name, title and the last message of its Bot Chat', async () => {
    roster([
      bot({ id: 'default', name: 'Hermes', title: 'Personal assistant' }),
      bot({ id: 'researcher', name: 'Deep Researcher', title: 'Finds sources' }),
    ]);
    jest.mocked(getBotMessages).mockImplementation(async (botId) =>
      botId === 'default'
        ? [{ role: 'user', content: 'ping' }, { role: 'assistant', content: 'pong' }]
        : [{ role: 'user', content: 'find papers' }],
    );
    await render(<HomeScreen />);

    expect(await screen.findByText('Hermes')).toBeOnTheScreen();
    expect(screen.getByText('HE')).toBeOnTheScreen();
    expect(screen.getByText('Personal assistant')).toBeOnTheScreen();
    expect(screen.getByText('Deep Researcher')).toBeOnTheScreen();
    expect(screen.getByText('DR')).toBeOnTheScreen();
    expect(await screen.findByText('pong')).toBeOnTheScreen();
    expect(await screen.findByText('find papers')).toBeOnTheScreen();
    expect(getBotMessages).toHaveBeenCalledWith('researcher', 'chat-researcher');
  });

  it('opens the Bot Chat route when a Bot is tapped', async () => {
    roster([bot({ id: 'researcher', name: 'Deep Researcher' })]);
    await render(<HomeScreen />);

    await userEvent.setup().press(await screen.findByText('Deep Researcher'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/bot/[botId]',
      params: { botId: 'researcher', name: 'Deep Researcher' },
    });
  });

  it('shows an unreachable Bot disabled, with a hint, and never fetches its chat', async () => {
    roster([bot({ id: 'researcher', name: 'Deep Researcher', reachable: false })]);
    await render(<HomeScreen />);

    expect(await screen.findByRole('button', { name: /Deep Researcher/ })).toBeDisabled();
    expect(screen.getByText(/Unreachable/)).toBeOnTheScreen();
    expect(getBotChat).not.toHaveBeenCalled();

    await userEvent.setup().press(screen.getByText('Deep Researcher'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says so when a Bot has no Bot Chat yet, and keeps the other previews', async () => {
    roster([bot({ id: 'default', name: 'Hermes' }), bot({ id: 'researcher', name: 'Deep Researcher' })]);
    jest.mocked(getBotChat).mockImplementation(async (botId) => {
      if (botId === 'researcher') throw new BffError('409', 409, 'bot_chat_missing');
      return { botId, sessionId: 'chat-default' };
    });
    jest.mocked(getBotMessages).mockResolvedValue([{ role: 'assistant', content: 'hello from default' }]);
    await render(<HomeScreen />);

    expect(await screen.findByText('No Bot Chat yet')).toBeOnTheScreen();
    expect(await screen.findByText('hello from default')).toBeOnTheScreen();
  });

  it('explains how to enable Bot Mode when it is off', async () => {
    roster([], false);
    await render(<HomeScreen />);

    expect(await screen.findByText('Bot Mode is not enabled')).toBeOnTheScreen();
    expect(screen.getByText(/Open Hermes Desktop/)).toBeOnTheScreen();
    expect(screen.getByText(/Go to the Bots tab and create a Bot/)).toBeOnTheScreen();
  });

  it('checks again from the Bot Mode screen', async () => {
    roster([], false);
    await render(<HomeScreen />);
    roster([bot({ name: 'Hermes' })]);

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('Hermes')).toBeOnTheScreen();
  });

  it('shows the error when the roster cannot be loaded', async () => {
    jest.mocked(listBots).mockRejectedValue(new Error('GET /bots failed (502)'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots failed (502)')).toBeOnTheScreen();
  });

  it('gives screen readers the name, title and preview or hint of each Bot', async () => {
    roster([
      bot({ id: 'default', name: 'Hermes', title: 'Personal assistant' }),
      bot({ id: 'researcher', name: 'Deep Researcher', reachable: false }),
    ]);
    jest.mocked(getBotMessages).mockResolvedValue([{ role: 'assistant', content: 'pong' }]);
    await render(<HomeScreen />);

    expect(await screen.findByRole('button', { name: 'Hermes, Personal assistant, pong' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Deep Researcher, Unreachable: the BFF has no API key for this Bot' }),
    ).toBeDisabled();
  });

  it('shows why "Check again" failed on the Bot Mode screen', async () => {
    roster([], false);
    await render(<HomeScreen />);
    jest.mocked(listBots).mockRejectedValue(new Error('GET /bots failed (502)'));

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('GET /bots failed (502)')).toBeOnTheScreen();
    expect(screen.getByText('Bot Mode is not enabled')).toBeOnTheScreen();
  });

  it('ignores previews from an earlier refresh that arrive late', async () => {
    roster([bot({ id: 'default', name: 'Hermes' })]);
    let resolveOld: (v: { role: 'assistant'; content: string }[]) => void = () => {};
    jest
      .mocked(getBotMessages)
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce([{ role: 'assistant', content: 'new preview' }]);
    await render(<HomeScreen />);
    await screen.findByText('Hermes');
    await waitFor(() => expect(getBotMessages).toHaveBeenCalledTimes(1));

    await fireEvent(screen.getByTestId('roster'), 'refresh');
    expect(await screen.findByText('new preview')).toBeOnTheScreen();

    await act(async () => resolveOld([{ role: 'assistant', content: 'old preview' }]));

    expect(screen.queryByText('old preview')).toBeNull();
    expect(screen.getByText('new preview')).toBeOnTheScreen();
  });

  it('ignores the failure and the end of an earlier refresh that a newer one replaced', async () => {
    let rejectOld: (e: Error) => void = () => {};
    let resolveNew: (r: BotsResponse) => void = () => {};
    jest
      .mocked(listBots)
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectOld = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNew = resolve)));
    await render(<HomeScreen />);
    await waitFor(() => expect(listBots).toHaveBeenCalledTimes(1));

    // Not awaited: this refresh stays pending until resolveNew below.
    void fireEvent(screen.getByTestId('roster'), 'refresh');
    await waitFor(() => expect(listBots).toHaveBeenCalledTimes(2));
    await act(async () => rejectOld(new Error('GET /bots failed (502)')));

    expect(screen.queryByText('GET /bots failed (502)')).toBeNull();
    expect(screen.getByTestId('roster')).toHaveProp('refreshing', true);

    await act(async () => resolveNew({ botModeEnabled: true, bots: [bot({ name: 'Hermes' })] }));

    expect(await screen.findByText('Hermes')).toBeOnTheScreen();
    expect(screen.getByTestId('roster')).toHaveProp('refreshing', false);
  });

  it('never offers to create a session', async () => {
    roster([bot({})]);
    await render(<HomeScreen />);
    await screen.findByText('Hermes');

    expect(screen.queryByText('New')).toBeNull();
  });
});

describe('HomeScreen with the local cache', () => {
  const BFF = 'http://bff.local:8787';
  const never = () => new Promise<never>(() => {});

  function cached(bots: BotSummary[], previews: Record<string, string> = {}, owner = BFF) {
    bindCache(owner);
    writeRoster({ botModeEnabled: true, bots }, previews);
  }

  it('paints the cached roster and previews immediately, marked as updating', async () => {
    cached([bot({ id: 'default', name: 'Hermes', title: 'Personal assistant' })], { default: 'saved pong' });
    jest.mocked(listBots).mockImplementation(never);
    await render(<HomeScreen />);

    expect(screen.getByText('Hermes')).toBeOnTheScreen();
    expect(screen.getByText('Personal assistant')).toBeOnTheScreen();
    expect(screen.getByText('saved pong')).toBeOnTheScreen();
    expect(screen.getByText('Updating…')).toBeOnTheScreen();
  });

  it('replaces the cached roster with the fresh one and saves it', async () => {
    cached([bot({ id: 'old', name: 'Old Bot' })], { old: 'old preview' });
    roster([bot({ id: 'default', name: 'Hermes' })]);
    jest.mocked(getBotMessages).mockResolvedValue([{ role: 'assistant', content: 'fresh pong' }]);
    await render(<HomeScreen />);

    expect(await screen.findByText('fresh pong')).toBeOnTheScreen();
    expect(screen.queryByText('Old Bot')).toBeNull();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(screen.queryByText(/showing saved/)).toBeNull();
    expect(readRoster()).toMatchObject({
      roster: { bots: [expect.objectContaining({ id: 'default', name: 'Hermes' })] },
      previews: { default: 'fresh pong' },
    });
  });

  it('keeps showing the saved roster with an offline hint when the refresh fails', async () => {
    cached([bot({ id: 'default', name: 'Hermes' })], { default: 'saved pong' });
    jest.mocked(listBots).mockRejectedValue(new Error('Network request failed'));
    await render(<HomeScreen />);

    expect(await screen.findByText(/Offline · showing saved data/)).toBeOnTheScreen();
    expect(screen.getByText('Hermes')).toBeOnTheScreen();
    expect(screen.getByText('saved pong')).toBeOnTheScreen();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(readRoster()?.previews).toEqual({ default: 'saved pong' });
  });

  it('caches nothing and shows the plain error when the first load fails', async () => {
    jest.mocked(listBots).mockRejectedValue(new Error('GET /bots failed (502)'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots failed (502)')).toBeOnTheScreen();
    expect(screen.queryByText(/showing saved/)).toBeNull();
    expect(readRoster()).toBeNull();
  });

  it("drops another BFF's roster as soon as it knows the app is paired elsewhere", async () => {
    cached([bot({ id: 'alpha', name: 'Alpha Bot' })], {}, 'http://other.local:8787');
    jest.mocked(listBots).mockImplementation(never);
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.queryByText('Alpha Bot')).toBeNull());
    expect(readRoster()).toBeNull();
  });
});
