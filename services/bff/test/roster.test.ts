import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRoster } from '../src/roster.ts';

function hermesHome(profiles: Record<string, string | null>, rootProfileYaml?: string) {
  const home = mkdtempSync(join(tmpdir(), 'hermes-home-'));
  if (rootProfileYaml) writeFileSync(join(home, 'profile.yaml'), rootProfileYaml);
  for (const [name, yaml] of Object.entries(profiles)) {
    const dir = join(home, 'profiles', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, yaml === null ? 'config.yaml' : 'profile.yaml'), yaml ?? 'model: {}\n');
  }
  return home;
}

describe('readRoster', () => {
  it('always lists the default profile as the primary Bot', () => {
    expect(readRoster(hermesHome({}))).toEqual({
      botModeEnabled: false,
      bots: [{ id: 'default', name: 'Hermes', title: null, description: null }],
    });
  });

  it('reads Bot Mode metadata and detects a managed install', () => {
    const home = hermesHome({
      researcher: 'display_name: Research Buddy\ndescription: Finds papers\nui_meta:\n  hermes-bots:\n    title: Researcher\n',
      plain: null,
    });
    const roster = readRoster(home);
    expect(roster.botModeEnabled).toBe(true);
    expect(roster.bots.map((b) => b.id)).toEqual(['default', 'plain', 'researcher']);
    expect(roster.bots[2]).toEqual({ id: 'researcher', name: 'Research Buddy', title: 'Researcher', description: 'Finds papers' });
  });

  it('skips deleted, invalid and marker-less profile dirs', () => {
    const home = hermesHome({ coder: null, 'Bad Name': null });
    mkdirSync(join(home, 'profiles', 'empty'));
    mkdirSync(join(home, 'profiles', '.deleted', 'coder'), { recursive: true });
    expect(readRoster(home).bots.map((b) => b.id)).toEqual(['default']);
  });
});
