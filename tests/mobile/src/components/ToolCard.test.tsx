import { render, screen, userEvent } from '@testing-library/react-native';
import { RESULT_PREVIEW_MAX, ToolCard } from '@mobile/components/ToolCard';

jest.mock('expo-router', () => ({
  useTheme: () => ({ colors: { text: 'black', border: 'gray', card: 'white', primary: 'blue' } }),
}));

describe('ToolCard', () => {
  it('shows the tool name, the args summary and a spinner while running, all in its label', async () => {
    await render(<ToolCard name="clock" args="tz: UTC" rawArgs='{"tz":"UTC"}' status="running" />);

    expect(screen.getByLabelText('Tool clock, tz: UTC, running')).toBeOnTheScreen();
    expect(screen.getByText('clock')).toBeOnTheScreen();
    expect(screen.getByText('tz: UTC')).toBeOnTheScreen();
    expect(screen.getByTestId('tool-spinner')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is collapsed when done and expands to the full args and the result on press, then collapses again', async () => {
    await render(<ToolCard name="clock" args="tz: UTC" rawArgs='{"tz":"UTC"}' status="done" result="12:00 UTC" />);
    const header = screen.getByRole('button', { name: 'Tool clock, tz: UTC, done' });

    expect(screen.queryByTestId('tool-spinner')).toBeNull();
    expect(screen.queryByText('12:00 UTC')).toBeNull();
    expect(header).not.toBeExpanded();

    await userEvent.setup().press(header);
    expect(screen.getByText('12:00 UTC')).toBeOnTheScreen();
    expect(screen.getByText('{"tz":"UTC"}')).toBeOnTheScreen();
    expect(header).toBeExpanded();

    await userEvent.setup().press(header);
    expect(screen.queryByText('12:00 UTC')).toBeNull();
  });

  it('keeps the expanded result outside the labelled header, so a screen reader reads it', async () => {
    await render(<ToolCard name="clock" args="" rawArgs="" status="done" result="12:00 UTC" />);
    const header = screen.getByRole('button', { name: 'Tool clock, done' });

    await userEvent.setup().press(header);

    const result = screen.getByTestId('tool-result');
    let node = result.parent;
    while (node) {
      expect(node).not.toBe(header);
      node = node.parent;
    }
  });

  it('truncates a long result when expanded', async () => {
    const long = 'x'.repeat(RESULT_PREVIEW_MAX + 50);
    await render(<ToolCard name="read" args="" rawArgs="" status="done" result={long} />);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Tool read, done' }));

    expect(screen.getByTestId('tool-result')).toHaveTextContent(`${'x'.repeat(RESULT_PREVIEW_MAX - 1)}…`);
  });

  it('says when a call from the history ended without a result, and is not expandable', async () => {
    await render(<ToolCard name="clock" args="" rawArgs="" status="no-result" />);

    expect(screen.getByLabelText('Tool clock, no result')).toBeOnTheScreen();
    expect(screen.getByText('no result')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('tool-spinner')).toBeNull();
  });
});
