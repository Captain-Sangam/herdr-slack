# Operations

This page tells how to find and fix problems with herdr-slack. Start with the status of the poller and the errors in the window.

## 1. First checks

1. Make sure that the window has no errors:

   ```sh
   herdr-app status | jq '{layout, errors}'
   ```

2. Read the poller's status:

   ```sh
   jq '."slack.status"' ~/.config/herdr-app/shared.json
   ```

3. Hover over the Slack button. The tooltip shows the same message.

| `state`       | Button                       | Go to                                                                             |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `ok`          | Unread count, or no badge    | Nothing to do.                                                                    |
| `no-token`    | A dot in the `blocked` color | [No token](#2-no-token)                                                           |
| `auth`        | A dot in the `blocked` color | [`missing_scope` and other token errors](#3-missing_scope-and-other-token-errors) |
| `ratelimited` | A dim dot                    | [`ratelimited`](#6-ratelimited)                                                   |
| `network`     | A dim dot                    | Check the network. The poller tries again each minute.                            |
| `error`       | A dim dot                    | Read the message. It has Slack's error code.                                      |

- In every state, the panel keeps the last items. A line over the list shows the message. With no items, the list shows the message.
- A dot shows only when the badge has no count.

## 2. No token

**Symptom:** the status is `no-token`. The panel says "No Slack token in the Keychain".

1. Make sure that the Keychain has the item. This command prints the attributes, not the secret:

   ```sh
   security find-generic-password -s herdr-slack >/dev/null && echo present
   ```

2. If the command prints nothing, store the token ([deployment, step 3](deployment.md#3-store-the-token-in-the-keychain)).
3. Wait for the next poll (at most 60 s). The poller reads the Keychain again on each poll until it finds the token.

- Do not print the token to check it. Use the `auth.test` check in the deployment guide. It gives the token to `curl` on stdin.

## 3. `missing_scope` and other token errors

**Symptom:** the status is `auth`, with a message such as "Slack refused the token (missing_scope)".

| Error                               | Cause                                            | Fix                                                                                                         |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `missing_scope`                     | The app does not have a scope that a call needs. | Add the scopes from `slack-app-manifest.yaml` and reinstall the app ([deployment](deployment.md#6-update)). |
| `invalid_auth`, `not_authed`        | The Keychain item does not hold a valid token.   | Store the token again.                                                                                      |
| `token_revoked`, `token_expired`    | The app was removed, or the token was revoked.   | Install the app again and store the new token.                                                              |
| `account_inactive`, `no_permission` | The Slack account or workspace refuses access.   | Ask a workspace admin.                                                                                      |

- After an `auth` error, the poller forgets the token and reads the Keychain again on the next poll. You do not have to reload the mod.
- Each scope has its own symptom when it is missing:
  - `*:history`: the conversation view says "Needs history permission". The list still works.
  - `files:read`: message thumbnails do not show. Slack sends HTML instead of an image, and the mod deletes it. There is no banner.
  - `search:read`: the poll fails with `missing_scope`.
  - `chat:write`: a reply fails with "Needs the chat:write permission". The list and the view still work.

## 4. A reply does not send

**Symptom:** a line over the composer says why. The text stays in the composer.

| Line                                | Cause                                                    | Fix                                                                            |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Needs the chat:write permission     | `missing_scope`: the app does not have `chat:write`.     | Add `chat:write` and reinstall the app ([deployment](deployment.md#6-update)). |
| You are not in this channel         | `not_in_channel`: you are not a member of the channel.   | Join the channel in Slack, then send again.                                    |
| This channel is archived            | `is_archived`: the channel takes no new messages.        | Reply in Slack somewhere else.                                                 |
| Slack cannot find this conversation | `channel_not_found`: you left it, or it was deleted.     | Open the conversation in Slack.                                                |
| A workspace setting stops you       | `restricted_action`: an admin limits who can post there. | Ask a workspace admin.                                                         |
| The message is too long             | `msg_too_long`: Slack's limit for one message.           | Make the text shorter, or send it in two parts.                                |
| Slack rate limit                    | `ratelimited` or HTTP 429.                               | Wait a minute, then send again.                                                |
| Cannot reach Slack                  | No connection. The post can still have arrived.          | Look in Slack first. Then send again only if the reply is not there.           |
| Slack refused the token             | `invalid_auth`, `token_revoked` and others.              | See [token errors](#3-missing_scope-and-other-token-errors).                   |

- Nothing retries a failed post. Send it again yourself.
- If Enter adds a line instead of sending, click Send. Then report it: the Enter binding depends on Herdr's input key context ([interfaces](interfaces.md#11-mod-api)).

## 5. Send to agent

**Symptom:** an error toast "Send to agent failed". The item stays unread.

| Toast                               | Cause                                                                        | Fix                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The agent "codex" is not installed. | The chosen agent is not in `knownAgents()` as installed.                     | Install the agent, or pick another one under the gear.                  |
| The model "…" is not valid          | The model has a character other than letters, digits, `.`, `-`, `_` and `/`. | Fix the model under the gear. The field does not save an invalid value. |
| `herdr-app` errors                  | `herdr-app do` failed, for example a missing folder.                         | Read the message. Run `herdr-app status`.                               |
| The folder "…" is not a full path   | The stored space folder does not start with `/` or `~/`.                     | Set the space again under the gear.                                     |

- To see the settings: `jq '."slack.agent"' ~/.config/herdr-app/shared.json`.
- An agent other than Claude gets the conversation in the task. If the task says "The conversation could not be loaded", the fetch failed. The usual cause is a missing `*:history` scope.
- To check what an agent gets, read the first message in its tab. It never holds the token.

## 6. `ratelimited`

**Symptom:** the status is `ratelimited`. The message tells when the next try is.

- The poller waits 1 min, then 2, 4 and 8 min, then 10 min for each next failure. One successful poll sets the wait back to zero.
- A poll makes 2 searches and at most 50 lookups. 20 are read marks (`last_read`). 10 each are for new people, group DM members and channel names.
- A reload of the mod (for example `./install.sh`) also sets the wait back to zero. Do not reload in a loop to skip the wait.

## 7. Stale usage and the probe

**Symptom:** a Claude row is dimmed, or shows a dash or `reset`.

| Display    | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| A dash     | No data. The cache file or the Codex logs have no value.             |
| `reset`    | The window's reset time has passed. A new value has not arrived yet. |
| Dimmed row | The data is older than 60 min. The tooltip shows its age.            |
| Spinner    | A probe runs.                                                        |

1. Make sure that the cache exists and is recent:

   ```sh
   jq '{at: (.at | todate), five: .rate_limits.five_hour}' ~/.cache/herdr-slack/claude-usage.json
   ```

2. If the file does not exist, add the status-line snippet ([deployment, step 4](deployment.md#4-add-the-status-line-snippet)). Then send one message in any Claude Code session.
3. If the file is old, click the meter. This starts a probe if no probe ran in the last 30 min. Else a toast tells when the next probe is allowed.
4. After a probe, make sure that no probe terminal stays:

   ```sh
   hc ls | grep herdr-usage-probe
   ```

- The meter starts a probe by itself only when the data is older than 60 min. The Mac must also be in use in the last 10 min.
- A probe that runs for more than 5 min is removed before the next probe.
- If a manual probe fails, a toast shows the error. Make sure that `claude` starts in a new Herdr terminal.
- For Codex, a dash means that no Codex session log of the last 8 days has a `token_count` event with `rate_limits`. Run one Codex turn.

## 8. The image cache `.slack-cache`

The images are in `~/.config/herdr-app/.slack-cache/` ([architecture](architecture.md#34-image-cache)).

- The poller deletes files that no item uses. You do not have to clean the cache.
- To start with an empty cache:
  1. Remove the folder:

     ```sh
     rm -rf ~/.config/herdr-app/.slack-cache
     ```

  2. Make the folders again. The button copy makes them only when it starts:

     ```sh
     mkdir -p ~/.config/herdr-app/.slack-cache/avatars ~/.config/herdr-app/.slack-cache/files ~/.config/herdr-app/.slack-cache/media
     ```

  3. Wait for the next polls. They download the images again.
- If an avatar or thumbnail does not show:
  - A failed download waits 10 min before the next try.
  - Each poll downloads at most 10 files.
  - A thumbnail needs the `files:read` scope.

## 9. Return to the `main` layout

- Show Herdr's own layout:

  ```sh
  herdr-app do layout.switch --name main
  ```

- Show herdr-slack again:

  ```sh
  herdr-app do layout.switch --name main-slack
  ```

- In the `main` layout, the meter, the Slack button and the panel do not run. `"slack"` stays in `workspace.panels`, which does no harm.
- If `main-slack.json` is broken, run `./install.sh` to build it again.

## 10. Known limits

- Each search gets the newest 50 matches each minute. If more than 50 matches arrive in one minute, the panel misses some.
- A message that you read in Slack clears in the panel within 1 or 2 polls (about 1 to 2 min). With more than 40 read marks that have unread items, it can take longer.
- A reply in a thread that you do not follow in Slack stays unread until you open it in the panel. Slack gives no `last_read` for that thread.
- Custom workspace emoji show as `:name:` text. The list dims them. The conversation view does not.
- A nested bullet under a numbered line shows as its own list.
- A channel mention written as `<#C123>` shows its id if the token cannot see that channel.
- For a mention outside a thread, the view can have a gap after it when more than 100 messages follow the mention.
- Send to agent to an agent other than Claude carries at most about 20,000 characters of the conversation. Older messages are cut.
- The emoji code can change text such as `aws:…:secret:…` that looks like `:secret:`.
