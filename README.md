# herdr-slack

Two mods for [Herdr.app](https://herdr.dev): a Claude/Codex usage meter and a Slack panel.

## What it is

- **Usage meter** (`mods/usage-meter`): Claude 5-hour and 7-day use and Codex use, each as
  percent used and time to reset, at the bottom of the sidebar above Settings.
  - Claude numbers come from Claude Code's status line (see below).
  - When they are more than an hour old and you are at the Mac, or when you click the
    meter, it starts a hidden one-word Claude Haiku session to refresh them, at most once
    every 30 minutes.
  - Codex numbers come from Codex's own session logs.
- **Slack panel** (`mods/slack`): a Slack button right of Files and Changes, with an unread
  badge, and a panel listing your DMs, group DMs and @-mentions, grouped by conversation and
  thread.
  - Click a row to read the conversation in the panel (read-only).
  - **Send to agent** opens Claude in a Herdr space named `space` at `~/code` and asks it
    to read the thread with its own Slack tools. The space, folder and the agent's command
    (`ARGV`, default model `claude-opus-5-5`) are set in `mods/slack/lib.js`.
  - Nothing in Slack is changed: no replies, reactions or read marks.
- `layout/main-slack.jq` builds a `main-slack` layout from Herdr's own `main.json`, so no
  shipped layout or mod is cloned and Herdr's updates keep coming.

Requirements:
- macOS: the token lives in the Keychain, and idle time comes from `ioreg`.
- Herdr.app with `herdr-app` and `hc` on `PATH`.
- Claude Code, for the usage meter and Send to agent.
- Codex (optional), for its usage row.
- `jq` and `curl`.
- Node 20 or later, only to run the tests.

## Install

```sh
./install.sh
```

It copies both mods to `~/.config/herdr-app/mods/`, builds `main-slack.json` from the
current `main.json`, checks both mods and switches the window to `main-slack`. It is safe
to rerun. Rerun it after a Herdr update that changes `main.json`. If `main.json` no longer
has the ids the patch needs, or a check fails, the old `main-slack.json` stays.

Tests: `node --test test/*.test.mjs` (or `npm test`).

## Slack app setup

1. Go to api.slack.com/apps, then Create New App, then From a manifest. Choose your
   workspace, paste `slack-app-manifest.yaml`, then Create.
2. Install to Workspace. Ask an admin to approve it if Slack asks for that.
3. On OAuth & Permissions, copy the User OAuth Token (`xoxp-…`).
4. Store it in the Keychain. Keep `-w` last so that `security` prompts for the token;
   paste it there. It never goes in argv or shell history:

   ```sh
   security add-generic-password -s herdr-slack -a "$USER" -U -w
   ```

5. Check it. The token goes to `curl` on stdin:

   ```sh
   security find-generic-password -s herdr-slack -w \
     | sed 's/.*/header = "Authorization: Bearer &"/' \
     | curl -s -K - https://slack.com/api/auth.test | jq '{ok, user_id}'
   ```

   It prints `"ok": true` and your own `user_id`.
6. To revoke: delete the app on api.slack.com/apps, then
   `security delete-generic-password -s herdr-slack`.

The panel reads the token from the Keychain (service `herdr-slack`) when it polls, keeps it
in memory only, and sends it only in an `Authorization` header. It asks `auth.test` whose
token it is, and searches for that user's mentions. Without the Keychain item the button
shows "No token".

Images: profile pictures and GIPHY images are public and are downloaded without the token.
Thumbnails of images shared in messages are private: they need the `files:read` scope, and
their download reads the token from the Keychain and gives it to `curl` on stdin. All of
them go into `~/.config/herdr-app/.slack-cache/`, and files that no item references any
more are deleted on the next poll.

Clicking a row opens a read-only conversation view in the panel: a DM's or group DM's
history (newest 50, with Load older), a thread, or the channel messages around a mention.
It reads with `conversations.history` and `conversations.replies`, which need the
`*:history` scopes. Without them, the view says "Needs history permission" and the list
keeps working. The view's messages stay in the panel's memory.

To add scopes to an app made from an older manifest: on api.slack.com/apps, open the app,
then OAuth & Permissions, then User Token Scopes, and add the missing ones from the
manifest. Click Reinstall to Workspace and allow it. If the User OAuth Token on that page
changed, store it again with setup step 4 (`-U` replaces the old one) and check it with
step 5.

Filters (the gear in the panel): **Include** lists channel patterns and never hides a DM
or group DM; empty means all channels. **Exclude** applies to everything: a channel by its
name, a DM by the other person's or bot's display name, real name or handle, and a group
DM by its name string (`*notetaker*` hides any group with a Notetaker bot). Patterns match
the whole name, case-insensitive: `*` is any run, `?` is one character. Exclude wins.

Unread state follows Slack's `last_read` from `conversations.info` for top-level messages
and DMs. Thread replies stay unread until you open or send them from the panel.

Emoji: Slack's `:short_name:` codes are shown as Unicode emoji. The map in
`mods/slack/emoji.js` is generated from iamcal/emoji-data by `node scripts/gen-emoji.mjs`.
Custom workspace emoji stay as dimmed `:name:` text.

## Claude usage capture (status line)

Claude Code gives its rate limits only to the status line command. The meter reads them
from `~/.cache/herdr-slack/claude-usage.json`, which your status-line script writes as:

```json
{"at": <unix seconds>, "rate_limits": <the rate_limits object from the status line input>}
```

For a bash status-line script that reads its input with one `jq` call and sets
`NOW=$(date +%s)`, add this field to the `jq` call:

```bash
  "RL="           + (.rate_limits | tojson | @sh)
```

and these lines after `NOW` is set:

```bash
# Usage cache for the Herdr usage meter — builtins only, no fork; a failed write is silent.
[[ "$RL" == *five_hour* ]] && { printf '{"at":%s,"rate_limits":%s}\n' "$NOW" "$RL" > ~/.cache/herdr-slack/claude-usage.json; } 2>/dev/null
```

Both are shell builtins, so the script starts no extra process. The cache folder is made
by `install.sh`. The write is not atomic; the meter keeps its last good value when it reads
a partial file.

## Uninstall

1. `herdr-app do layout.switch --name main`
2. `rm -rf ~/.config/herdr-app/mods/usage-meter ~/.config/herdr-app/mods/slack ~/.config/herdr-app/layouts/main-slack.json ~/.config/herdr-app/.slack-cache`
3. Take the status-line additions out of your status-line script.
4. `rm -rf ~/.cache/herdr-slack`
5. Revoke the Slack app (setup step 6).
6. The mod added `"slack"` to Herdr's shared `workspace.panels` list. With Herdr closed,
   remove it: `jq '."workspace.panels" -= ["slack"]' ~/.config/herdr-app/shared.json`,
   saved back to that file.
