# Deployment

This page tells how to set up herdr-slack on a Mac. It covers the Slack app, the token, the status-line snippet, the install, updates and the uninstall.

## 1. Requirements

- macOS. The token lives in the Keychain, and the idle time comes from `ioreg`.
- Herdr.app, with `herdr-app` and `hc` on the `PATH`.
- Claude Code, for the Claude rows of the meter and for Send to agent.
- Codex (optional), for its usage row.
- `jq` and `curl`.
- Node 20 or later, only to run the tests.

## 2. Create the Slack app

1. Open api.slack.com/apps.
2. Click Create New App, then From a manifest.
3. Choose your workspace.
4. Paste the content of `slack-app-manifest.yaml`, then click Create.
5. Click Install to Workspace. If Slack asks for an admin approval, ask an admin to approve the app.
6. Open OAuth & Permissions. Copy the User OAuth Token. It starts with `xoxp`.

The manifest asks for read-only user scopes and no bot user ([interfaces](interfaces.md#21-methods-and-scopes)).

## 3. Store the token in the Keychain

1. Run this command. Keep `-w` last, so that `security` prompts for the token:

   ```sh
   security add-generic-password -s herdr-slack -a "$USER" -U -w
   ```

2. Paste the token at the prompt. The token never goes into argv or the shell history.
3. Check the token. This command gives the token to `curl` on stdin:

   ```sh
   security find-generic-password -s herdr-slack -w \
     | sed 's/.*/header = "Authorization: Bearer &"/' \
     | curl -s -K - https://slack.com/api/auth.test | jq '{ok, user_id}'
   ```

4. Make sure that the output has `"ok": true` and your own `user_id`.

- The mod reads the item by its service name `herdr-slack`. The account name is not used.
- `-U` replaces an old item with the same service and account.

## 4. Add the status-line snippet

Claude Code gives its rate limits only to the status-line command. The meter reads them from `~/.cache/herdr-slack/claude-usage.json`, which your status-line script writes.

If your status-line script is a bash script that reads its input with one `jq` call and sets `NOW=$(date +%s)`, do these steps:

1. Add this field to the `jq` call:

   ```bash
     "RL="           + (.rate_limits | tojson | @sh)
   ```

2. Add these lines after the line that sets `NOW`:

   ```bash
   # Usage cache for the Herdr usage meter: builtins only, no fork. A failed write is silent.
   [[ "$RL" == *five_hour* ]] && { printf '{"at":%s,"rate_limits":%s}\n' "$NOW" "$RL" > ~/.cache/herdr-slack/claude-usage.json; } 2>/dev/null
   ```

- Both lines use shell builtins, so the script starts no extra process.
- `install.sh` makes the folder `~/.cache/herdr-slack`.
- The write is not atomic. The meter keeps its last good value when it reads a partial file.
- With another kind of status-line script, write the same JSON object to the same file.

## 5. Install

1. From the repo root, run the installer:

   ```sh
   ./install.sh
   ```

2. Make sure that `herdr-app status` shows `"layout": "main-slack"` and `"errors": []`.

The installer does these steps in this order:

1. Makes `~/.cache/herdr-slack`.
2. Copies `mods/usage-meter` and `mods/slack` to `~/.config/herdr-app/mods/`. Herdr reloads the running copies.
3. Builds the new layout from `~/.config/herdr-app/layouts/main.json` into a temporary file, with `layout/main-slack.jq`.
4. Runs `herdr-app check` on both mods.
5. Moves the temporary file to `~/.config/herdr-app/layouts/main-slack.json`.
6. Runs `herdr-app do layout.switch --name main-slack`.

- If `jq` or a check fails, the script stops. The old `main-slack.json` stays.
- The installer builds the installed `main-slack.json` from the current Herdr `main.json` each time. It does not use the file `layouts/main-slack.json` in the repo.
- `layouts/main-slack.json` in the repo is a snapshot for herdr.dev. People who install from herdr.dev copy this file ([`RECIPE.md`](../RECIPE.md)). After a Herdr update that changes `main.json`, refresh the snapshot with the command in [`AGENTS.md`](../AGENTS.md#commands).
- The installer never writes `main.json` or a shipped mod.
- You can run the installer again at any time.

Files that herdr-slack writes:

| Path                                                                     | Written by                              |
| ------------------------------------------------------------------------ | --------------------------------------- |
| `~/.config/herdr-app/mods/usage-meter/`                                  | `install.sh`                            |
| `~/.config/herdr-app/mods/slack/`                                        | `install.sh`                            |
| `~/.config/herdr-app/layouts/main-slack.json`                            | `install.sh`                            |
| `~/.config/herdr-app/shared.json`, `slack.*` keys and `workspace.panels` | The `slack` mod, through Herdr          |
| `~/.config/herdr-app/data/slack/`, `data/usage-meter/`                   | The mods' `localStorage`, through Herdr |
| `~/.config/herdr-app/.slack-cache/`                                      | The `slack` mod                         |
| `~/.cache/herdr-slack/claude-usage.json`                                 | Your status-line script                 |

## 6. Update

- **After a Herdr update:** run `./install.sh` again. Herdr can change `main.json`, and the installer builds `main-slack.json` from the new version. If the new `main.json` no longer has the ids that the patch needs, the installer stops and keeps the old layout. Then change `layout/main-slack.jq`.
- **After a change in this repo:** run `./install.sh` again. The copy reloads the mods.
- **To add scopes to an app from an older manifest:**
  1. On api.slack.com/apps, open the app, then OAuth & Permissions.
  2. Under User Token Scopes, add the scopes that `slack-app-manifest.yaml` lists and the app does not have.
  3. Click Reinstall to Workspace, then allow it.
  4. If the User OAuth Token changed, store it again with [step 3](#3-store-the-token-in-the-keychain).

## 7. Uninstall

1. Show Herdr's own layout:

   ```sh
   herdr-app do layout.switch --name main
   ```

2. Remove the mods, the layout, their stored data and the image cache:

   ```sh
   rm -rf ~/.config/herdr-app/mods/usage-meter ~/.config/herdr-app/mods/slack \
     ~/.config/herdr-app/layouts/main-slack.json \
     ~/.config/herdr-app/data/usage-meter ~/.config/herdr-app/data/slack \
     ~/.config/herdr-app/.slack-cache
   ```

3. Remove the status-line lines from your status-line script.
4. Remove the usage cache: `rm -rf ~/.cache/herdr-slack`.
5. Delete the Slack app on api.slack.com/apps. This revokes the token.
6. Delete the token from the Keychain: `security delete-generic-password -s herdr-slack`.
7. Quit Herdr. Then remove the `slack.*` keys and the `"slack"` panel id from `~/.config/herdr-app/shared.json`:

   ```sh
   f=~/.config/herdr-app/shared.json
   jq 'with_entries(select(.key | startswith("slack.") | not)) | ."workspace.panels" -= ["slack"]' "$f" > "$f.new" && mv "$f.new" "$f"
   ```
