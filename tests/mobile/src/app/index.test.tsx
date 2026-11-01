import type { BotSummary, BotsResponse } from '@hermes-mobile/api';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import HomeScreen from '@mobile/app/index';
import { BffError, getBotChat, getBotMessages, listBots } from '@mobile/lib/bff';
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

  it('never offers to create a session', async () => {
    roster([bot({})]);
    await render(<HomeScreen />);
    await screen.findByText('Hermes');

    expect(screen.queryByText('New')).toBeNull();
  });
});
