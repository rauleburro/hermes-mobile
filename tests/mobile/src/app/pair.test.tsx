import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { router } from 'expo-router';
import PairScreen from '@mobile/app/pair';
import { BffError, checkHealth } from '@mobile/lib/bff';
import { loadConfig, saveConfig } from '@mobile/lib/config';
import { ensureLocalNetworkAccess, LOCAL_NETWORK_HINT, localNetworkHint } from '@mobile/lib/localNetwork';

// The screen only needs a theme, the route params (the pairing link's query) and router.replace.
const mockParams = jest.fn((): Record<string, string | string[]> => ({}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams(),
  useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red' } }),
}));
// Network and secure storage are the screen's only side effects.
jest.mock('@mobile/lib/bff', () => ({ BffError: jest.requireActual('@mobile/lib/bff').BffError, checkHealth: jest.fn() }));
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn().mockResolvedValue(null), saveConfig: jest.fn() }));
// Android 17's Nearby devices permission (covered by the localNetwork tests): only its answers matter here.
jest.mock('@mobile/lib/localNetwork', () => ({
  ...jest.requireActual('@mobile/lib/localNetwork'),
  ensureLocalNetworkAccess: jest.fn(),
  localNetworkHint: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.mockReturnValue({});
  mockedLoadConfig.mockResolvedValue(null);
  mockedEnsureAccess.mockResolvedValue('not-needed');
  mockedHint.mockReturnValue(null);
});

const mockedCheckHealth = jest.mocked(checkHealth);
const mockedSaveConfig = jest.mocked(saveConfig);
const mockedLoadConfig = jest.mocked(loadConfig);
const mockedEnsureAccess = jest.mocked(ensureLocalNetworkAccess);
const mockedHint = jest.mocked(localNetworkHint);

const urlField = () => screen.getByPlaceholderText('http://192.168.1.10:8787');
const tokenField = () => screen.getByPlaceholderText('from `pnpm pair`');

async function fillForm(url: string, token: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('http://192.168.1.10:8787'), url);
  await user.type(screen.getByPlaceholderText('from `pnpm pair`'), token);
  return user;
}

describe('PairScreen', () => {
  it('asks for the BFF URL and device token, and cannot pair until both are filled', async () => {
    await render(<PairScreen />);

    expect(screen.getByText('BFF URL')).toBeOnTheScreen();
    expect(screen.getByText('Device token')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();

    await fillForm('http://bff.local:8787', 'secret');

    expect(screen.getByRole('button', { name: 'Pair' })).toBeEnabled();
  });

  it('stays disabled while only the URL is filled', async () => {
    await render(<PairScreen />);

    await fillForm('http://bff.local:8787', '');

    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
  });

  it('stays disabled while only the token is filled', async () => {
    await render(<PairScreen />);

    await fillForm('', 'secret');

    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
  });

  it('checks the BFF, stores the trimmed config and goes home', async () => {
    mockedCheckHealth.mockResolvedValue({ ok: true, hermes: true });
    await render(<PairScreen />);

    const user = await fillForm('  http://bff.local:8787/  ', ' secret ');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    const config = { url: 'http://bff.local:8787', token: 'secret' };
    expect(mockedCheckHealth).toHaveBeenCalledWith(config);
    expect(mockedSaveConfig).toHaveBeenCalledWith(config);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('shows why pairing failed and stays on the screen', async () => {
    mockedCheckHealth.mockRejectedValue(new Error('timeout'));
    await render(<PairScreen />);

    const user = await fillForm('http://bff.local:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Could not reach the BFF: timeout')).toBeOnTheScreen();
    expect(mockedSaveConfig).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('rejects a typed URL that is not http(s) without contacting anything', async () => {
    await render(<PairScreen />);

    const user = await fillForm('bff.local:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Enter the BFF URL as http://host:port or https://host.')).toBeOnTheScreen();
    expect(mockedCheckHealth).not.toHaveBeenCalled();
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});

describe('PairScreen opened from the pairing link (hermesmobile://pair?url=…&token=…)', () => {
  it('prefills the URL (without trailing slash) and the token, and waits for the user to tap Pair', async () => {
    mockParams.mockReturnValue({ url: 'http://localhost:8787/', token: 'link-token' });
    await render(<PairScreen />);

    expect(urlField()).toHaveDisplayValue('http://localhost:8787');
    expect(tokenField()).toHaveDisplayValue('link-token');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeEnabled();
    expect(mockedCheckHealth).not.toHaveBeenCalled();
  });

  it('pairs with the link values when the user taps Pair', async () => {
    mockParams.mockReturnValue({ url: 'http://localhost:8787', token: 'link-token' });
    mockedCheckHealth.mockResolvedValue({ ok: true, hermes: true });
    await render(<PairScreen />);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Pair' }));

    expect(mockedSaveConfig).toHaveBeenCalledWith({ url: 'http://localhost:8787', token: 'link-token' });
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('uses the first value of a repeated param', async () => {
    mockParams.mockReturnValue({ url: ['http://a.local:1', 'http://b.local:2'], token: ['one', 'two'] });
    await render(<PairScreen />);

    expect(urlField()).toHaveDisplayValue('http://a.local:1');
    expect(tokenField()).toHaveDisplayValue('one');
  });

  it('explains a malformed URL in the link and leaves the field empty', async () => {
    mockParams.mockReturnValue({ url: 'javascript:alert(1)', token: 'link-token' });
    await render(<PairScreen />);

    expect(screen.getByText('The pairing link has an invalid BFF URL.')).toBeOnTheScreen();
    expect(urlField()).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
  });

  it('keeps the token from a token-only link and fills the URL from the stored pairing', async () => {
    mockParams.mockReturnValue({ token: 'link-token' });
    mockedLoadConfig.mockResolvedValue({ url: 'http://old.local:8787', token: 'old-token' });
    await render(<PairScreen />);

    expect(await screen.findByDisplayValue('http://old.local:8787')).toBeOnTheScreen();
    expect(tokenField()).toHaveDisplayValue('link-token');
  });

  it('warns that the link replaces an existing pairing, and the link values win', async () => {
    mockParams.mockReturnValue({ url: 'http://new.local:8787', token: 'link-token' });
    mockedLoadConfig.mockResolvedValue({ url: 'http://old.local:8787', token: 'old-token' });
    await render(<PairScreen />);

    expect(await screen.findByText('Pairing replaces the current BFF (http://old.local:8787).')).toBeOnTheScreen();
    expect(urlField()).toHaveDisplayValue('http://new.local:8787');
    expect(tokenField()).toHaveDisplayValue('link-token');
  });

  it('refills the form when a new link arrives while the screen is already open', async () => {
    await render(<PairScreen />);
    expect(urlField()).toHaveDisplayValue('');

    mockParams.mockReturnValue({ url: 'http://localhost:8795/', token: 'link-token' });
    await screen.rerender(<PairScreen />);

    expect(urlField()).toHaveDisplayValue('http://localhost:8795');
    expect(tokenField()).toHaveDisplayValue('link-token');
  });

  it('shows the stored pairing when opened without a link', async () => {
    mockedLoadConfig.mockResolvedValue({ url: 'http://old.local:8787', token: 'old-token' });
    await render(<PairScreen />);

    expect(await screen.findByDisplayValue('http://old.local:8787')).toBeOnTheScreen();
    expect(tokenField()).toHaveDisplayValue('old-token');
    expect(screen.queryByText(/replaces the current BFF/)).toBeNull();
  });

  it('reuses the stored token when the link points at the stored BFF', async () => {
    mockParams.mockReturnValue({ url: 'http://old.local:8787/' });
    mockedLoadConfig.mockResolvedValue({ url: 'http://old.local:8787', token: 'old-token' });
    await render(<PairScreen />);

    expect(await screen.findByDisplayValue('old-token')).toBeOnTheScreen();
  });
});

describe('PairScreen never sends the stored token to another BFF', () => {
  const stored = { url: 'http://old.local:8787', token: 'old-token' };

  it('leaves the token empty for a URL-only link to another host, so Pair stays disabled', async () => {
    mockParams.mockReturnValue({ url: 'https://attacker.example' });
    mockedLoadConfig.mockResolvedValue(stored);
    await render(<PairScreen />);
    await waitFor(() => expect(mockedLoadConfig).toHaveBeenCalled());
    await act(async () => {});

    expect(urlField()).toHaveDisplayValue('https://attacker.example');
    expect(tokenField()).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
    expect(mockedCheckHealth).not.toHaveBeenCalled();
  });

  it('clears the stored token when a URL-only link to another host arrives while the screen is open', async () => {
    mockedLoadConfig.mockResolvedValue(stored);
    await render(<PairScreen />);
    expect(await screen.findByDisplayValue('old-token')).toBeOnTheScreen();

    mockParams.mockReturnValue({ url: 'https://attacker.example' });
    await screen.rerender(<PairScreen />);

    expect(urlField()).toHaveDisplayValue('https://attacker.example');
    expect(tokenField()).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled();
  });

  it('refuses to send the stored token after the URL is edited to another host', async () => {
    mockedLoadConfig.mockResolvedValue(stored);
    await render(<PairScreen />);
    expect(await screen.findByDisplayValue('old-token')).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.clear(urlField());
    await user.type(urlField(), 'https://attacker.example');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(mockedCheckHealth).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the device token for this BFF (from `pnpm pair`).')).toBeOnTheScreen();
  });

  it('does not let a slow stored-config load overwrite a link that arrived meanwhile', async () => {
    let resolveLoad: (c: typeof stored) => void = () => {};
    mockedLoadConfig.mockReturnValueOnce(new Promise((r) => (resolveLoad = r)));
    await render(<PairScreen />);

    mockParams.mockReturnValue({ url: 'http://new.local:8787', token: 'link-token' });
    await screen.rerender(<PairScreen />);
    await act(async () => resolveLoad(stored));

    expect(urlField()).toHaveDisplayValue('http://new.local:8787');
    expect(tokenField()).toHaveDisplayValue('link-token');
  });

  it('says nothing about replacing when a token-only link keeps the same BFF', async () => {
    mockParams.mockReturnValue({ token: 'link-token' });
    mockedLoadConfig.mockResolvedValue(stored);
    await render(<PairScreen />);
    expect(await screen.findByDisplayValue('http://old.local:8787')).toBeOnTheScreen();

    expect(screen.queryByText(/replaces the current BFF/)).toBeNull();
  });

  it('clears the URL when a link with an invalid URL arrives while the screen is open', async () => {
    mockedLoadConfig.mockResolvedValue(stored);
    await render(<PairScreen />);
    expect(await screen.findByDisplayValue('http://old.local:8787')).toBeOnTheScreen();

    mockParams.mockReturnValue({ url: 'javascript:alert(1)', token: 'link-token' });
    await screen.rerender(<PairScreen />);

    expect(screen.getByText('The pairing link has an invalid BFF URL.')).toBeOnTheScreen();
    expect(urlField()).toHaveDisplayValue('');
  });
});

describe('PairScreen on the local network (Android 17 Nearby devices)', () => {
  it('asks for Nearby devices before contacting a local BFF', async () => {
    mockedCheckHealth.mockResolvedValue({ ok: true, hermes: true });
    await render(<PairScreen />);

    const user = await fillForm('http://192.168.1.10:8787/', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(mockedEnsureAccess).toHaveBeenCalledWith('http://192.168.1.10:8787');
    expect(mockedEnsureAccess.mock.invocationCallOrder[0]).toBeLessThan(mockedCheckHealth.mock.invocationCallOrder[0]);
    expect(mockedSaveConfig).toHaveBeenCalled();
  });

  it('explains a denied Nearby devices right away, and still tries the BFF', async () => {
    mockedEnsureAccess.mockResolvedValue('denied');
    let answer: (h: { ok: boolean; hermes: boolean }) => void = () => {};
    mockedCheckHealth.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(<PairScreen />);

    const user = await fillForm('http://192.168.1.10:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    // Shown while the request may hang, not only after it gives up.
    expect(await screen.findByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
    expect(mockedCheckHealth).toHaveBeenCalled();

    await act(async () => answer({ ok: true, hermes: true }));
    expect(mockedSaveConfig).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('names Nearby devices when Pair fails with a network error to a local address, and opens the settings', async () => {
    const error = new TypeError('Network request failed');
    mockedCheckHealth.mockRejectedValue(error);
    mockedHint.mockReturnValue(LOCAL_NETWORK_HINT);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<PairScreen />);

    const user = await fillForm('http://hermes-bff.local:9', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Could not reach the BFF: Network request failed')).toBeOnTheScreen();
    expect(screen.getByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
    expect(mockedHint).toHaveBeenCalledWith('http://hermes-bff.local:9', error);

    await user.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  it('keeps the denied Nearby devices hint when the health check then times out', async () => {
    const { localNetworkHint: realHint } = jest.requireActual<typeof import('@mobile/lib/localNetwork')>('@mobile/lib/localNetwork');
    mockedHint.mockImplementation((url, error) => realHint(url, error, { OS: 'android', Version: 37 }));
    mockedEnsureAccess.mockResolvedValue('denied');
    mockedCheckHealth.mockRejectedValue(new BffError('GET /health timed out', undefined, 'timeout'));
    await render(<PairScreen />);

    const user = await fillForm('http://192.168.1.10:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Could not reach the BFF: GET /health timed out')).toBeOnTheScreen();
    expect(screen.getByText(LOCAL_NETWORK_HINT)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeOnTheScreen();
  });

  it('still pairs when asking for the permission itself fails', async () => {
    mockedEnsureAccess.mockRejectedValue(new Error('PermissionsAndroid is not installed correctly.'));
    mockedCheckHealth.mockResolvedValue({ ok: true, hermes: true });
    await render(<PairScreen />);

    const user = await fillForm('http://192.168.1.10:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(mockedSaveConfig).toHaveBeenCalled();
  });

  it('shows no hint or settings button when the failure is not about the local network', async () => {
    mockedCheckHealth.mockRejectedValue(new Error('GET /health failed (500)'));
    await render(<PairScreen />);

    const user = await fillForm('http://192.168.1.10:8787', 'secret');
    await user.press(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByText('Could not reach the BFF: GET /health failed (500)')).toBeOnTheScreen();
    expect(screen.queryByText(LOCAL_NETWORK_HINT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
  });
});
