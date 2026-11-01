import type { SessionMessage } from '@hermes-mobile/api';
import { markdownToPlainText } from './markdown';

/** Avatar placeholder: two letters from the Bot's name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The last chat line (user or assistant) of a Bot Chat, collapsed to one line for the roster.
 * Replies read as they render (Markdown projected to plain text); user text stays literal.
 */
export function lastMessagePreview(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { role, content } = messages[i];
    if ((role !== 'user' && role !== 'assistant') || !content) continue;
    const text = (role === 'assistant' ? markdownToPlainText(content) : content).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}
