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

  it("shows an assistant reply as it reads once rendered, without Markdown syntax", () => {
    const reply = '## Done\n\nSee **the [release notes](https://example.com/notes)** for `v2`.';
    expect(lastMessagePreview([msg('user', 'hi'), msg('assistant', reply)])).toBe('Done See the release notes for v2.');
  });

  it('keeps what the user wrote literally', () => {
    expect(lastMessagePreview([msg('user', 'use **stars** and `ticks`')])).toBe('use **stars** and `ticks`');
  });

  it('skips a reply that renders as nothing (only a reference definition)', () => {
    expect(lastMessagePreview([msg('user', 'first'), msg('assistant', '[d]: https://example.com')])).toBe('first');
  });

  it('skips a hidden row, which the Bot Chat does not show either', () => {
    const hidden: SessionMessage = { role: 'assistant', content: 'internal bookkeeping', display_kind: 'hidden' };
    expect(lastMessagePreview([msg('user', 'what the user sees'), hidden])).toBe('what the user sees');
  });

  it("previews the user's own Bot Chat sends, which Hermes stores as internal notifications", () => {
    const sent: SessionMessage = { role: 'user', content: 'sent from the app', display_kind: 'internal_notification' };
    expect(lastMessagePreview([msg('assistant', 'older reply'), sent])).toBe('sent from the app');
  });

  it('is null when there is nothing to show', () => {
    expect(lastMessagePreview([])).toBeNull();
  });
});
