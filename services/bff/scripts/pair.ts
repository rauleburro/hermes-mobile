// Ensures a DEVICE_TOKEN exists in services/bff/.env and prints a pairing link + QR for the phone.
// Usage: pnpm pair [--url <bff-url>] [--rotate]. Without --url the link uses the first LAN address;
// over USB with `adb reverse tcp:<port> tcp:<port>` use --url http://localhost:<port>.
// A fork build with its own URL scheme sets APP_SCHEME (shell or services/bff/.env).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';
import { ENV_PATH } from '../src/config.ts';
import { pairingLink, pairingUrl, preparePairing } from '../src/pairing.ts';

const example = new URL('../.env.example', import.meta.url);
const env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : readFileSync(example, 'utf8');

// Plan and validate (APP_SCHEME, --url) before anything is written, so a bad value never rotates the token.
const plan = preparePairing({
  envText: env,
  rotate: process.argv.includes('--rotate'),
  shellScheme: process.env.APP_SCHEME,
  generateToken: () => randomBytes(32).toString('base64url'),
});
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const url = pairingUrl({ argv: process.argv.slice(2), port: plan.port, lanIp });
const { token } = plan;
const link = pairingLink(url, token, plan.scheme);

if (plan.changed) {
  writeFileSync(ENV_PATH, plan.envText, { mode: 0o600 });
  console.log(`Wrote a new DEVICE_TOKEN to ${ENV_PATH} (restart the BFF to pick it up).`);
}

console.log(`\nBFF URL: ${url}\nToken:   ${token}\nLink:    ${link}\n\nScan with the phone camera (needs a development build) or paste the values in the app:\n`);
qrcode.generate(link, { small: true });
