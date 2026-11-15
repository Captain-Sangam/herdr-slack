# Security

## Report a vulnerability

Do not open a public issue. Use [private vulnerability reporting](https://github.com/Captain-Sangam/herdr-slack/security/advisories/new) on GitHub.

Include:

- what you found
- the steps to reproduce it
- the versions of herdr-slack, Herdr.app and macOS.

## Scope

- **In scope:** the `slack` and `usage-meter` mods, `install.sh`, the layout patch and the Slack app manifest.
- **Out of scope:** Herdr.app, `hc`, Slack, Claude Code and Codex. Report those to their makers.
- Processes that run as the same macOS user are trusted. They can read Herdr's files and ask the Keychain for the token.

## Token handling

- The Slack user token lives in the macOS Keychain, as a generic password with service `herdr-slack`.
- The mods keep it in memory only. They send it only in an `Authorization` header, or to `curl` on stdin for file thumbnails.
- It never goes into argv, a file, Herdr's shared state, `localStorage`, a log, the agent task or the repo.
- Never paste the token into a command line, an issue or a chat. Store it with `security add-generic-password … -w` as the last option, so that `security` prompts for it.
- To revoke the token, delete the Slack app on api.slack.com/apps. Then delete the Keychain item.

Details: [architecture, token and privacy model](docs/architecture.md#5-token-and-privacy-model) and [ADR 0005](docs/adr/0005-token-in-keychain.md).

## Read-only scopes

- `slack-app-manifest.yaml` asks only for read scopes: `search:read`, `users:read`, `files:read`, and the `*:read` and `*:history` scopes for channels, private channels, DMs and group DMs.
- The app has no bot user and no write scope. The panel cannot post, react or mark messages read.
- Token rotation is off, so the token does not expire. Revoke it when you stop using herdr-slack.

## Prompt injection through Send to agent

WARNING: Send to agent gives Slack content to a Claude Code agent that has tool access. A message from any sender can hold instructions for the agent.

- Anyone who can send you a DM or mention you can put text into the agent's context. This includes people outside your company in shared channels, and bots.
- The task tells Claude to treat everything that it fetches as data, not instructions, and to change nothing in Slack. This lowers the risk. It does not remove it.
- The agent starts with Claude Code's normal permission settings in the space `space` at `~/code`. If those settings allow commands without approval, a hostile message can try to run commands or to read and send files.
- Send only messages that you trust to an agent.
- Keep approval prompts on for the agent's session. Read each command that it asks to run.
- The agent reads Slack through its own connector. Its access is that connector's access, not this app's read-only token.

## Other risks

- Message previews, names and permalinks of up to 150 items are on disk in `~/.config/herdr-app/shared.json`.
- Avatars and message thumbnails are on disk in `~/.config/herdr-app/.slack-cache/`.
- The conversation view keeps its messages in memory only.
