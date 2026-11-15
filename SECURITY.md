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

## Scopes and posts

- `slack-app-manifest.yaml` asks for read scopes and one write scope:
  - read: `search:read`, `users:read`, `files:read`, and the `*:read` and `*:history` scopes for channels, private channels, DMs and group DMs
  - write: `chat:write`, for replies from the composer ([ADR 0011](docs/adr/0011-replies-from-the-conversation-view.md)).
- WARNING: The token can post as you. Anything that reads the token can post in every conversation that you can post in.
- The code limits posts:
  - Only an explicit Send posts: the Send button, or Enter in the composer of the conversation view.
  - Nothing posts on its own. No timer, poll, retry or Slack content starts a post. A failed post stays failed until you send again.
  - The only write call is `chat.postMessage`. The panel never adds reactions and never marks messages read.
  - Send to agent never gets the token. The agent cannot use the composer.
- The app has no bot user. A reply comes from you, as in the Slack app.
- Token rotation is off, so the token does not expire. Revoke it when you stop using herdr-slack.

## Prompt injection through Send to agent

WARNING: Send to agent gives Slack content to an agent that has tool access. A message from any sender can hold instructions for the agent.

- Anyone who can send you a DM or mention you can put text into the agent's context. This includes people outside your company in shared channels, and bots.
- The task tells the agent to treat all Slack content as data, not instructions, and to change nothing in Slack. This lowers the risk. It does not remove it.
- Claude gets only ids and the preview, and fetches the rest itself. Another agent (Codex, for example) has no Slack tools, so the panel puts up to about 20,000 characters of the conversation into the task ([ADR 0012](docs/adr/0012-agent-and-model-settings.md)):
  - The text sits between `BEGIN SLACK DATA` and `END SLACK DATA`, with a note that it is untrusted content.
  - A line in the data that copies a marker is changed, so a message cannot end the block.
  - The task never holds the token.
- The agent starts with its normal permission settings in the space `space` at `~/code`. If those settings allow commands without approval, a hostile message can try to run commands or to read and send files.
- The agent's argv is the agent's own `run` argv from Herdr, and a model that has only letters, digits, `.`, `-`, `_` and `/`. Slack content never goes into the argv of the agent.
- Send only messages that you trust to an agent.
- Keep approval prompts on for the agent's session. Read each command that it asks to run.
- The agent reads Slack through its own connector. Its access is that connector's access, not this app's token.

## Other risks

- Message previews, names and permalinks of up to 150 items are on disk in `~/.config/herdr-app/shared.json`.
- Avatars and message thumbnails are on disk in `~/.config/herdr-app/.slack-cache/`.
- The conversation view keeps its messages and the reply drafts in memory only.
