import { render, screen, userEvent } from '@testing-library/react-native';
import ChatScreen from '@mobile/app/chat/[sessionId]';
import { followRun, getMessages, sendMessage } from '@mobile/lib/bff';

// The screen needs route params, a theme and Stack.Screen from expo-router.
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ sessionId: 'session-1', title: 'Bot Chat' }),
  useTheme: () => ({ dark: false, colors: { text: 'black', border: 'gray', primary: 'blue', card: 'white' } }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@mobile/lib/bff', () => ({
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  followRun: jest.fn(),
  resolveApproval: jest.fn(),
  stopRun: jest.fn(),
}));

const mockedGetMessages = jest.mocked(getMessages);
const mockedSendMessage = jest.mocked(sendMessage);
const mockedFollowRun = jest.mocked(followRun);

describe('ChatScreen message rendering', () => {
  beforeEach(() => {
    mockedGetMessages.mockResolvedValue([
      { id: 1, role: 'user', content: 'Please use **stars** and `ticks`' },
      { id: 2, role: 'assistant', content: 'Sure, **bold** reply' },
    ] as never);
  });

  it('shows what the user sent as plain text, without interpreting Markdown', async () => {
    await render(<ChatScreen />);

    expect(await screen.findByText('Please use **stars** and `ticks`')).toBeOnTheScreen();
  });

  it('shows a reply that is still streaming as plain text (Markdown only once it is final)', async () => {
    mockedSendMessage.mockResolvedValue({ runId: 'run-1', replayed: false });
    // Emit one delta, then keep the run open.
    mockedFollowRun.mockImplementation(async (_id, onEvent) => {
      onEvent({ event: 'message.delta', run_id: 'run-1', delta: 'Partial **bold**' } as never);
      await new Promise(() => {});
    });
    const user = userEvent.setup();
    await render(<ChatScreen />);

    await user.type(screen.getByPlaceholderText('Message Hermes'), 'hi');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Partial **bold**')).toBeOnTheScreen();
  });

  it('renders assistant replies as Markdown', async () => {
    await render(<ChatScreen />);

    expect(await screen.findByText('bold')).toBeOnTheScreen();
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });
});
