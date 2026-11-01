import { render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import PairScreen from '@mobile/app/pair';
import { checkHealth } from '@mobile/lib/bff';
import { loadConfig, saveConfig } from '@mobile/lib/config';

// The screen only needs a theme, the route params (the pairing link's query) and router.replace.
const mockParams = jest.fn((): Record<string, string | string[]> => ({}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams(),
  useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red' } }),
}));
// Network and secure storage are the screen's only side effects.
jest.mock('@mobile/lib/bff', () => ({ checkHealth: jest.fn() }));
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn().mockResolvedValue(null), saveConfig: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.mockReturnValue({});
  mockedLoadConfig.mockResolvedValue(null);
});

const mockedCheckHealth = jest.mocked(checkHealth);
const mockedSaveConfig = jest.mocked(saveConfig);
const mockedLoadConfig = jest.mocked(loadConfig);

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

  it('shows the stored pairing when opened without a link', async () => {
    mockedLoadConfig.mockResolvedValue({ url: 'http://old.local:8787', token: 'old-token' });
    await render(<PairScreen />);

    expect(await screen.findByDisplayValue('http://old.local:8787')).toBeOnTheScreen();
    expect(tokenField()).toHaveDisplayValue('old-token');
    expect(screen.queryByText(/replaces the current BFF/)).toBeNull();
  });
});
