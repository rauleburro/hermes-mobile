import type { SessionMessage } from '@hermes-mobile/api';

/** Avatar placeholder: two letters from the Bot's name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/** The last chat line (user or assistant) of a Bot Chat, collapsed to one line for the roster. */
export function lastMessagePreview(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { role, content } = messages[i];
    if ((role === 'user' || role === 'assistant') && content?.trim()) {
      return content.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}
