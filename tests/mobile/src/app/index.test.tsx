import type { BotSummary, BotsResponse, SessionMessage } from '@hermes-mobile/api';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import HomeScreen from '@mobile/app/index';
import { BffError, getBotChat, getBotMessages, listBots } from '@mobile/lib/bff';
import { bindCache, cacheStorage, readRoster, writeRoster } from '@mobile/lib/cache';
import { loadConfig, pairedUrl } from '@mobile/lib/config';
import { LOCAL_NETWORK_HINT, localNetworkHint } from '@mobile/lib/localNetwork';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn() },
    // Render the header's Pair button so tests can see it.
    Stack: { Screen: ({ options }: { options?: { headerLeft?: () => unknown } }) => options?.headerLeft?.() ?? null },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red', card: 'white', primary: 'blue' } }),
  };
});
jest.mock('@mobile/lib/bff', () => {
  const actual = jest.requireActual('@mobile/lib/bff');
  return { BffError: actual.BffError, listBots: jest.fn(), getBotChat: jest.fn(), getBotMessages: jest.fn() };
});
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn(), pairedUrl: jest.fn() }));
// Whether a failure is Android 17's Nearby devices is covered by the localNetwork tests.
jest.mock('@mobile/lib/localNetwork', () => ({ ...jest.requireActual('@mobile/lib/localNetwork'), localNetworkHint: jest.fn() }));

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
  jest.mocked(pairedUrl).mockReturnValue('http://bff.local:8787');
  jest.mocked(getBotChat).mockImplementation(async (botId) => ({ botId, sessionId: `chat-${botId}` }));
  jest.mocked(getBotMessages).mockResolvedValue([]);
  jest.mocked(localNetworkHint).mockReturnValue(null);
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
  const OTHER = 'http://other.local:8787';
  const never = () => new Promise<never>(() => {});

  function cached(bots: BotSummary[], previews: Record<string, string> = {}, owner = BFF) {
    bindCache(owner);
    writeRoster(owner, { botModeEnabled: true, bots }, previews);
  }

  /** Lets a test decide when the pending `GET /bots` answers. */
  function pendingRoster() {
    let answer: (r: BotsResponse) => void = () => {};
    jest.mocked(listBots).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    return (bots: BotSummary[]) => act(async () => answer({ botModeEnabled: true, bots }));
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
    expect(readRoster(BFF)).toMatchObject({
      roster: { bots: [expect.objectContaining({ id: 'default', name: 'Hermes' })] },
      previews: { default: 'fresh pong' },
    });
  });

  it('keeps showing the saved roster with an offline hint when the BFF cannot be reached', async () => {
    cached([bot({ id: 'default', name: 'Hermes' })], { default: 'saved pong' });
    jest.mocked(listBots).mockRejectedValue(new TypeError('Network request failed'));
    await render(<HomeScreen />);

    expect(await screen.findByText('Offline · showing saved data')).toBeOnTheScreen();
    expect(screen.getByText('Hermes')).toBeOnTheScreen();
    expect(screen.getByText('saved pong')).toBeOnTheScreen();
    expect(screen.queryByText('Updating…')).toBeNull();
    expect(readRoster(BFF)?.previews).toEqual({ default: 'saved pong' });
  });

  it("shows the BFF's error, not 'Offline', next to the saved roster when the BFF answered with one", async () => {
    cached([bot({ id: 'default', name: 'Hermes' })]);
    jest.mocked(listBots).mockRejectedValue(new BffError('GET /bots failed (401)', 401, 'unauthorized'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots failed (401) · showing saved data')).toBeOnTheScreen();
    expect(screen.queryByText(/Offline/)).toBeNull();
    expect(screen.getByText('Hermes')).toBeOnTheScreen();
  });

  it('caches nothing and shows the plain error when the first load fails', async () => {
    jest.mocked(listBots).mockRejectedValue(new Error('GET /bots failed (502)'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots failed (502)')).toBeOnTheScreen();
    expect(screen.queryByText(/showing saved/)).toBeNull();
    expect(readRoster(BFF)).toBeNull();
  });

  it('never paints a saved roster that belongs to another BFF than the paired one', async () => {
    cached([bot({ id: 'alpha', name: 'Alpha Bot' })], {}, OTHER);
    jest.mocked(listBots).mockImplementation(never);
    await render(<HomeScreen />);

    expect(screen.queryByText('Alpha Bot')).toBeNull();
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it("never saves a roster that lands after re-pairing into the new BFF's cache", async () => {
    bindCache(BFF);
    const answer = pendingRoster();
    await render(<HomeScreen />);
    bindCache(OTHER); // Paired with another BFF while GET /bots to the first one is in flight.

    await answer([bot({ id: 'alpha', name: 'Alpha from one' })]);

    expect(readRoster(OTHER)).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual(['meta']);
  });

  it("never saves a preview that lands after re-pairing into the new BFF's cache", async () => {
    bindCache(BFF);
    let preview: (m: SessionMessage[]) => void = () => {};
    jest.mocked(getBotMessages).mockImplementation(() => new Promise((resolve) => (preview = resolve)));
    roster([bot({ id: 'default', name: 'Hermes' })]);
    await render(<HomeScreen />);
    await screen.findByText('Hermes');
    await waitFor(() => expect(getBotMessages).toHaveBeenCalled());
    bindCache(OTHER);

    await act(async () => preview([{ role: 'assistant', content: 'pong from one' }]));

    expect(readRoster(OTHER)).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual(['meta']);
  });
});

describe('HomeScreen header', () => {
  it('opens the pair screen from a Pair button that keeps a gap before the "Bots" title', async () => {
    roster([bot({})]);
    await render(<HomeScreen />);
    jest.mocked(router.push).mockClear();

    const pair = screen.getByRole('button', { name: 'Pair' });
    await userEvent.setup().press(pair);
    expect(router.push).toHaveBeenCalledWith('/pair');

    const action = StyleSheet.flatten(screen.getByTestId('pair-action').props.style);
    expect(action.marginEnd).toBeGreaterThanOrEqual(12);
  });
});

describe('HomeScreen on the local network (Android 17 Nearby devices)', () => {
  const BFF = 'http://bff.local:8787';
  const networkError = new TypeError('Network request failed');

  beforeEach(() => {
    jest.mocked(localNetworkHint).mockImplementation((url, error) => (url === BFF && error === networkError ? LOCAL_NETWORK_HINT : null));
  });

  it('names Nearby devices under the error when the roster fails to load from a local BFF, and opens the settings', async () => {
    jest.mocked(listBots).mockRejectedValue(networkError);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<HomeScreen />);

    expect(await screen.findByText('Network request failed')).toBeOnTheScreen();
    expect(screen.getByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  it('names Nearby devices next to the saved roster too', async () => {
    bindCache(BFF);
    writeRoster(BFF, { botModeEnabled: true, bots: [bot({ id: 'default', name: 'Hermes' })] }, {});
    jest.mocked(listBots).mockRejectedValue(networkError);
    await render(<HomeScreen />);

    expect(await screen.findByText('Offline · showing saved data')).toBeOnTheScreen();
    expect(screen.getByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
    expect(screen.getByText('Hermes')).toBeOnTheScreen();
  });

  it('drops the hint once the roster loads', async () => {
    jest.mocked(listBots).mockRejectedValueOnce(networkError);
    await render(<HomeScreen />);
    await screen.findByText(LOCAL_NETWORK_HINT);

    roster([bot({ id: 'default', name: 'Hermes' })]);
    await act(async () => {
      fireEvent(screen.getByTestId('roster'), 'refresh');
    });

    expect(await screen.findByText('Hermes')).toBeOnTheScreen();
    expect(screen.queryByText(LOCAL_NETWORK_HINT)).toBeNull();
  });

  it('names Nearby devices when the roster request times out (Android drops blocked local traffic silently)', async () => {
    const { localNetworkHint: realHint } = jest.requireActual<typeof import('@mobile/lib/localNetwork')>('@mobile/lib/localNetwork');
    jest.mocked(localNetworkHint).mockImplementation((url, error) => realHint(url, error, { OS: 'android', Version: 37 }));
    jest.mocked(listBots).mockRejectedValue(new BffError('GET /bots timed out', undefined, 'timeout'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots timed out')).toBeOnTheScreen();
    expect(screen.getByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
  });

  it('shows no hint when the failure is not about the local network', async () => {
    jest.mocked(listBots).mockRejectedValue(new Error('GET /bots failed (502)'));
    await render(<HomeScreen />);

    expect(await screen.findByText('GET /bots failed (502)')).toBeOnTheScreen();
    expect(screen.queryByText(LOCAL_NETWORK_HINT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
  });
});
