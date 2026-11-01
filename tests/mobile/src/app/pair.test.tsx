import { render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import PairScreen from '@mobile/app/pair';
import { checkHealth } from '@mobile/lib/bff';
import { saveConfig } from '@mobile/lib/config';

// The screen only needs a theme, the (empty) route params and router.replace from expo-router.
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  useTheme: () => ({ colors: { text: 'black', border: 'gray', notification: 'red' } }),
}));
// Network and secure storage are the screen's only side effects.
jest.mock('@mobile/lib/bff', () => ({ checkHealth: jest.fn() }));
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn().mockResolvedValue(null), saveConfig: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

const mockedCheckHealth = jest.mocked(checkHealth);
const mockedSaveConfig = jest.mocked(saveConfig);

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
});
