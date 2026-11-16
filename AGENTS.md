# AGENTS.md

herdr-slack adds two mods and a generated layout to Herdr.app on macOS:

- `mods/usage-meter/`: Claude 5-hour and 7-day use and Codex 7-day use, above Settings in the sidebar.
- `mods/slack/`: a Slack button in the tab bar and a Slack panel. The panel lists DMs, group DMs and mentions, has a conversation view with a reply composer, and has Send to agent.
- `install.sh` and `layout/main-slack.jq`: build `~/.config/herdr-app/layouts/main-slack.json` from Herdr's own `main.json`.

The code is plain JavaScript (gpui-kit mods), shell, jq, YAML and JSON. The pure logic is in each mod's `lib.js`, and `test/` tests it. Everything else is in [`docs/`](docs/README.md).

## Docs

| Doc                                            | Content                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`docs/README.md`](docs/README.md)             | The index, and the list of ADRs.                                                   |
| [`docs/architecture.md`](docs/architecture.md) | Components, the poll and the shared keys, the caches, the token and privacy model. |
| [`docs/adr/`](docs/README.md#decisions-adr)    | One ADR for each design decision.                                                  |
| [`docs/interfaces.md`](docs/interfaces.md)     | The Herdr, Slack, Claude Code and Codex facts that the code uses.                  |
| [`docs/deployment.md`](docs/deployment.md)     | The Slack app, the Keychain, the status-line snippet, install, update, uninstall.  |
| [`docs/operations.md`](docs/operations.md)     | Troubleshooting and known limits.                                                  |
| [`docs/testing.md`](docs/testing.md)           | Unit tests, `herdr-app check`, manual checks, screenshots for the docs.            |
| [`SECURITY.md`](SECURITY.md)                   | Token handling, scopes, prompt injection, how to report a problem.                 |

## Commands

| Task                             | Command                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Run the unit tests               | `npm test`                                                                                                                                |
| Check the format                 | `scripts/format.sh --check`                                                                                                               |
| Format files                     | `scripts/format.sh [PATH...]`                                                                                                             |
| Install the mods and the layout  | `./install.sh`                                                                                                                            |
| Check a mod                      | `herdr-app check ~/.config/herdr-app/mods/slack` (also `mods/usage-meter`)                                                                |
| Show the window's errors         | `herdr-app status`                                                                                                                        |
| Make `mods/slack/emoji.js` again | `node scripts/gen-emoji.mjs`                                                                                                              |
| Refresh the layout snapshot      | `jq -f layout/main-slack.jq ~/.config/herdr-app/layouts/main.json > layouts/main-slack.json && scripts/format.sh layouts/main-slack.json` |

- Before each commit, run `npm test`, `scripts/format.sh --check`, `./install.sh`, both `herdr-app check` commands and `herdr-app status`. The status must show `"errors": []`.
- Turn on the pre-commit hook once per clone: `git config core.hooksPath .githooks`.
- CI runs the format check and `npm test`. It cannot run `herdr-app check`.

## Rules for agents that change this repo

- **Hot reload:** Herdr reloads a mod when a file in `~/.config/herdr-app/mods/<name>/` changes. `./install.sh` copies the repo's mods there, so each install reloads the running copies. Change the repo, not the installed copy.
- **Checks:** after each mod change, run `./install.sh`, then `herdr-app check` on the mod and `herdr-app status`. A broken save keeps the old version running, so a screen that still works is no proof.
- **Shipped Herdr files:** never edit them. These include `layouts/main.json`, the shipped mods, and the `AGENTS.md` and `.d.ts` files in `~/.config/herdr-app`. Change Herdr only through `install.sh` and the files that it writes.
- **Slack token:** never put it in argv, a file, `shared`, `localStorage`, a log, the agent task or a commit. Read it from the Keychain. Send it only in an `Authorization` header, or to `curl` on stdin. Never print it.
- **Personal data:** the repo is public. Use invented data, as in `test/` and `docs/assets/` ([testing](docs/testing.md#6-screenshots-for-the-docs)). Never commit any of these:
  - real Slack content, names, avatars, or user and channel ids
  - workspace hosts, local paths or email addresses
  - tokens
  - a screenshot of a real window.
- **`.agents/`:** the private council record. It is local only. It never goes to the public repo, and no public file links to it.
- **Herdr:** drive it only with `hc` and `herdr-app`. Never use the legacy `herdr` CLI.
- **Behaviour:** posts only from an explicit Send in the composer; no reactions, no read marks, no automatic posts.
- **Send to agent:** the agent, the model and the space are settings in `shared("slack.agent")`, set under the panel's gear. The defaults (`AGENT`: Claude with `claude-opus-5-5`; `SPACE`: `space` at `~/code`) and the model suggestions (`MODELS`) are in `mods/slack/lib.js`. Send finds the space by its stored id, then its name, and makes it only when neither is open ([ADR 0014](docs/adr/0014-send-to-space-setting.md)). Never put the token in the agent task.

## Conventions

- **Commits:** conventional messages (`feat(slack): …`, `fix(usage-meter): …`, `docs: …`). Stage files by path. The pre-commit hook formats staged files and refuses a file that also has unstaged changes.
- **Decisions:** a new design decision gets a new ADR in `docs/adr/`. Change the docs that describe the code in the same commit.
- **Docs:** Simplified Technical English, bullets, exact names and commands. No emojis and no em dashes.
- **Generated files:** `mods/slack/emoji.js` comes from `scripts/gen-emoji.mjs`. Do not edit it by hand. The formatter skips it.
