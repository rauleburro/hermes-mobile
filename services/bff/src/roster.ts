// Bot roster read from Hermes' documented profile files (MVP: the BFF runs on the same Mac).
// Mirrors tools/bot_mode_probe.py `_roster` (Hermes 0.22.5): the default profile lives at the
// Hermes root, named profiles under profiles/<id>/. See docs/FUTURE.md for replacing this
// with an API once the BFF leaves the Mac.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { BotSummary } from '@hermes-mobile/api';

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IDENTITY_MARKERS = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'auth.json', 'state.db'];

type ProfileYaml = {
  description?: unknown;
  display_name?: unknown;
  ui_meta?: { 'hermes-bots'?: { title?: unknown } | null } | null;
};

export type Roster = { botModeEnabled: boolean; bots: Omit<BotSummary, 'reachable'>[] };

function readProfileYaml(dir: string): ProfileYaml | null {
  try {
    const data = parse(readFileSync(join(dir, 'profile.yaml'), 'utf8')) as unknown;
    return data && typeof data === 'object' ? (data as ProfileYaml) : null;
  } catch {
    return null;
  }
}

function isLiveProfile(profilesDir: string, name: string): boolean {
  const dir = join(profilesDir, name);
  return (
    name !== 'default' &&
    PROFILE_ID_RE.test(name) &&
    IDENTITY_MARKERS.some((m) => existsSync(join(dir, m))) &&
    !existsSync(join(profilesDir, '.deleted', name))
  );
}

export function readRoster(hermesHome: string): Roster {
  const profilesDir = join(hermesHome, 'profiles');
  const named = existsSync(profilesDir)
    ? readdirSync(profilesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && isLiveProfile(profilesDir, e.name))
        .map((e) => e.name)
        .sort()
    : [];

  let botModeEnabled = false;
  const bots = [
    { id: 'default', dir: hermesHome },
    ...named.map((id) => ({ id, dir: join(profilesDir, id) })),
  ].map(({ id, dir }) => {
    const meta = readProfileYaml(dir);
    const botMeta = meta?.ui_meta?.['hermes-bots'];
    if (botMeta && typeof botMeta === 'object') botModeEnabled = true;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      id,
      name: str(meta?.display_name) ?? (id === 'default' ? 'Hermes' : id),
      title: str(botMeta?.title),
      description: str(meta?.description),
    };
  });

  return { botModeEnabled, bots };
}
