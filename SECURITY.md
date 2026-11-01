# Security policy

Hermes Mobile is an unofficial client for Hermes Agent, not affiliated with Nous Research.

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull request.

Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it, and which commit you tested. Do not include real tokens, API keys or personal data in the report: use placeholders.

If the **Report a vulnerability** button is not available, open a public issue titled **Security contact request** with no details at all (do not describe the problem, the affected component or how to reproduce it). The maintainer will reply there with a private channel to continue.

This is a small, single-maintainer project. Expect an acknowledgement as time allows, with no guaranteed response time. Please give us a reasonable chance to fix the issue before disclosing it publicly.

Vulnerabilities in Hermes Agent itself should be reported to the Hermes Agent project, not here.

## Supported versions

Only the latest commit on `main` is supported. There are no maintained release branches; fixes land on `main`.

## Deployment guidance

- **Never expose the BFF to the public internet.** The device token is the only gate in front of it: anyone who has it can read and write your Bot Chats and approve tools. Run the BFF on your LAN or a private network such as Tailscale, or reach it over USB with `adb reverse`, and keep `BFF_HOST` as narrow as you can (`127.0.0.1` when using `adb reverse`).
- Treat the device token like a password. It is stored in `services/bff/.env` (never committed) and in the phone's secure storage. If it leaks, run `pnpm pair --rotate` and restart the BFF.
- The Hermes API key lives only in the BFF environment (`HERMES_API_KEY`, its copy of Hermes' `API_SERVER_KEY`, plus any `HERMES_PROFILE_KEY_*`) and never reaches the phone.
- Don't paste pairing links, QR codes, tokens or `.env` contents into issues or screenshots: a pairing link contains the device token.
