// Ensures a DEVICE_TOKEN exists in services/bff/.env and prints a pairing link + QR for the phone.
// Usage: pnpm pair [--url <bff-url>] [--rotate]. Without --url the link uses the first LAN address;
// over USB with `adb reverse tcp:<port> tcp:<port>` use --url http://localhost:<port>.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';
import { ENV_PATH } from '../src/config.ts';
import { pairingLink, pairingUrl } from '../src/pairing.ts';

const example = new URL('../.env.example', import.meta.url);
let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : readFileSync(example, 'utf8');

let token = env.match(/^DEVICE_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token || process.argv.includes('--rotate')) {
  token = randomBytes(32).toString('base64url');
  env = /^DEVICE_TOKEN=.*$/m.test(env)
    ? env.replace(/^DEVICE_TOKEN=.*$/m, `DEVICE_TOKEN=${token}`)
    : `${env.trimEnd()}\nDEVICE_TOKEN=${token}\n`;
  writeFileSync(ENV_PATH, env, { mode: 0o600 });
  console.log(`Wrote a new DEVICE_TOKEN to ${ENV_PATH} (restart the BFF to pick it up).`);
}

const port = env.match(/^BFF_PORT=(\d+)$/m)?.[1] ?? '8787';
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const url = pairingUrl({ argv: process.argv.slice(2), port, lanIp });
const link = pairingLink(url, token);

console.log(`\nBFF URL: ${url}\nToken:   ${token}\nLink:    ${link}\n\nScan with the phone camera (needs a development build) or paste the values in the app:\n`);
qrcode.generate(link, { small: true });
