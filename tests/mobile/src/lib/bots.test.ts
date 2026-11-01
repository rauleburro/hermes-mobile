import type { SessionMessage } from '@hermes-mobile/api';
import { initials, lastMessagePreview } from '@mobile/lib/bots';

describe('initials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(initials('deep researcher')).toBe('DR');
  });

  it('uses the first two letters of a single word', () => {
    expect(initials('Hermes')).toBe('HE');
  });

  it('falls back to a placeholder for a blank name', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('lastMessagePreview', () => {
  const msg = (role: SessionMessage['role'], content: string | null): SessionMessage => ({ role, content });

  it('returns the last user or assistant message with content, collapsed to one line', () => {
    const messages = [msg('user', 'hello'), msg('assistant', 'Hi there,\n\nhow can I help?'), msg('tool', '{"ok":true}')];
    expect(lastMessagePreview(messages)).toBe('Hi there, how can I help?');
  });

  it('skips empty messages and system/tool rows', () => {
    expect(lastMessagePreview([msg('user', 'first'), msg('assistant', ''), msg('system', 'sys')])).toBe('first');
  });

  it('is null when there is nothing to show', () => {
    expect(lastMessagePreview([])).toBeNull();
  });
});
