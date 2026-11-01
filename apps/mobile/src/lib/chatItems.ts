import type { SessionMessage, ToolCall } from '@hermes-mobile/api';

export type ToolStatus = 'running' | 'done' | 'no-result';

export type ChatItem =
  | { kind: 'message'; key: string; role: 'user' | 'assistant'; text: string }
  | {
      kind: 'tool';
      key: string;
      name: string;
      /** One-line summary, secrets masked. */
      args: string;
      /** The arguments as Hermes stored them, shown only on expand. */
      rawArgs: string;
      status: ToolStatus;
      result?: string;
    };

const ARGS_SUMMARY_MAX = 60;

const numericId = (row: SessionMessage): number | null => {
  const id = Number(row.id);
  return row.id !== undefined && row.id !== null && Number.isFinite(id) ? id : null;
};

/**
 * Adds polled rows to the ones already shown, deduplicated on the Hermes row id. New rows are
 * appended (a poll only brings rows newer than the history); known ones are replaced in place.
 * Returns `current` itself when nothing changed, so a no-op poll doesn't re-render.
 */
export function mergeRows(current: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  const byId = new Map(current.map((r, i) => [String(r.id), i] as const).filter(([, i]) => current[i].id != null));
  let next: SessionMessage[] | null = null;
  for (const row of incoming) {
    if (row.id == null) continue;
    const at = byId.get(String(row.id));
    if (at === undefined) {
      next ??= [...current];
      byId.set(String(row.id), next.length);
      next.push(row);
    } else if (JSON.stringify(current[at]) !== JSON.stringify(row)) {
      next ??= [...current];
      next[at] = row;
    }
  }
  return next ?? current;
}

/** The newest row id, the baseline that tells this turn's rows from the history. */
export const maxRowId = (rows: SessionMessage[]) =>
  rows.reduce((max, r) => Math.max(max, numericId(r) ?? -Infinity), -Infinity);

/** True once a row id is newer than `baseline`; rows without an id can't be placed, so they count. */
export const isAfter = (row: SessionMessage, baseline: number) => {
  const id = numericId(row);
  return id === null || id > baseline;
};

/**
 * The turn's final answer: assistant text with no tool calls (interim text always carries them),
 * and not a fragment cut at the length limit (truncation recovery appends text-only partials).
 */
export const isFinalAnswer = (row: SessionMessage) =>
  row.role === 'assistant' && !row.tool_calls?.length && row.finish_reason !== 'length' && Boolean(row.content?.trim());

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const MASK = '•••';
/** Only the start of an argument feeds a 60-character summary; masking more is wasted work. */
const ARGS_SCAN_MAX = 500;
const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|auth|credential/i;
const SECRET_HEADER = /((?:proxy-)?authorization|cookie|[\w-]*(?:api[-_]?key|token|secret|passw(?:or)?d)[\w-]*)(["']?\s*:\s*["']?)(?:(basic|bearer|token|digest)\s+)?[^\s"',}]+/gi;

/** Rules in order: each pattern keeps its context and replaces the secret with •••. */
const SECRET_RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // `X-Api-Key: v`, `Authorization: Basic v`, and the JSON form `"X-Api-Key":"v"`.
  [SECRET_HEADER, (_m, name, sep, scheme) => `${name}${sep}${scheme ? `${scheme} ` : ''}${MASK}`],
  [/(Bearer\s+)[^\s"']+/gi, `$1${MASK}`],
  // NAME=value where NAME looks secret, quoted or not: PASSWORD=, PGPASSWORD='', API_KEY="".
  [/(\b[A-Z0-9_]*(?:PASS(?:WORD)?|SECRET|TOKEN|KEY)[A-Z0-9_]*=)(['"]?)[^\s'"]+/gi, `$1$2${MASK}`],
  // user:pass@host in URLs.
  [/(\/\/[^\s:/@'"]+:)[^\s@/'"]+@/g, `$1${MASK}@`],
  // curl -u user:pass, --user user:pass.
  [/((?:^|\s)(?:-u|--user)(?:=|\s+)['"]?[^\s:'"]+:)[^\s'"]+/g, `$1${MASK}`],
  // --password value, --password=value, --pass value.
  [/(--pass(?:word)?(?:=|\s+)['"]?)[^\s'"]+/gi, `$1${MASK}`],
  // -pVALUE (mysql style, value attached).
  [/((?:^|\s)-p)[^\s'"]+/g, `$1${MASK}`],
  // Bare tokens with well-known prefixes.
  [/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})/g, MASK],
];

/** Hermes doesn't redact tool arguments: hide obvious secrets in the always-visible summary. */
const maskSecrets = (text: string) =>
  SECRET_RULES.reduce(
    (t, [re, replacement]) => t.replace(re, replacement as (substring: string, ...args: string[]) => string),
    text.slice(0, ARGS_SCAN_MAX),
  );

/**
 * A one-line summary of a tool call's JSON arguments: `key: value, …`, with secret-looking keys and
 * values masked. The full arguments are only shown when the card is expanded.
 */
export function summarizeArgs(args: string | null | undefined): string {
  if (!args) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return truncate(maskSecrets(args), ARGS_SUMMARY_MAX);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return truncate(maskSecrets(args), ARGS_SUMMARY_MAX);
  const parts = Object.entries(parsed).map(([key, value]) =>
    SECRET_KEY.test(key) ? `${key}: ${MASK}` : `${key}: ${maskSecrets(typeof value === 'string' ? value : JSON.stringify(value))}`,
  );
  return truncate(parts.join(', '), ARGS_SUMMARY_MAX);
}

/**
 * Turns Bot Chat rows into what the chat shows: user and assistant text, and one compact card per
 * tool call, done once its `role=tool` result row exists. An unanswered call is `running` only in
 * the live turn (row id after `liveAfterId`); in the history it ended without a result.
 * Hidden rows (`display_kind: hidden`), system rows and reasoning are never shown.
 */
export function buildChatItems(rows: SessionMessage[], { liveAfterId }: { liveAfterId?: number } = {}): ChatItem[] {
  const visible = rows.filter((r) => r.display_kind !== 'hidden');
  // A call's result is a `role=tool` row after the call and before the next user row. Call ids are
  // not unique across a Bot Chat (deterministic ids, compaction), so never search session-wide.
  const resultFor = (from: number, call: ToolCall) => {
    const ids = [call.id, call.call_id].filter(Boolean);
    for (let i = from + 1; i < visible.length && visible[i].role !== 'user'; i++) {
      const r = visible[i];
      if (r.role === 'tool' && r.tool_call_id && ids.includes(r.tool_call_id)) return r;
    }
    return undefined;
  };

  const items: ChatItem[] = [];
  visible.forEach((row, index) => {
    if (row.role !== 'user' && row.role !== 'assistant') return;
    const key = row.id != null ? String(row.id) : `i${index}`;
    if (row.content?.trim()) items.push({ kind: 'message', key: `m-${key}`, role: row.role, text: row.content });
    if (row.role !== 'assistant') return;
    for (const call of row.tool_calls ?? []) {
      const result = resultFor(index, call);
      const live = liveAfterId !== undefined && isAfter(row, liveAfterId);
      items.push({
        kind: 'tool',
        key: `t-${key}-${call.id}`,
        name: call.function?.name ?? 'tool',
        args: summarizeArgs(call.function?.arguments),
        rawArgs: call.function?.arguments ?? '',
        status: result ? 'done' : live ? 'running' : 'no-result',
        ...(result ? { result: result.content ?? '' } : {}),
      });
    }
  });
  return items;
}
