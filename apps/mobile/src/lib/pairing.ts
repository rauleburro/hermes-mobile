// Parsing for the pairing link `<scheme>://pair?url=<bff-url>&token=<device-token>` (any scheme: expo-router routes on `pair`)
// (the QR printed by `pnpm pair` in services/bff) and for URLs typed by hand.

type Param = string | string[] | undefined;

export type PairParams = { url?: string; token?: string; error?: string };

/** Trimmed http(s) URL without trailing slashes, or null if it is not a usable BFF URL. */
export function normalizeBffUrl(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(value)) return null;
  try {
    new URL(value);
  } catch {
    return null;
  }
  return value;
}

function first(param: Param): string | undefined {
  const value = (Array.isArray(param) ? param[0] : param)?.trim();
  return value ? value : undefined;
}

export function parsePairParams(params: { url?: Param; token?: Param }): PairParams {
  const result: PairParams = {};
  const rawUrl = first(params.url);
  const token = first(params.token);
  if (rawUrl) {
    const url = normalizeBffUrl(rawUrl);
    if (url) result.url = url;
  }
  if (token) result.token = token;
  if (rawUrl && !result.url) result.error = 'The pairing link has an invalid BFF URL.';
  return result;
}
