# Interfaces

This page lists the outside facts that the code depends on. They come from Herdr, the Slack Web API, the Claude Code status line and the Codex session logs. If one of them changes, the code must change too.

- **Checked against:** Herdr.app 0.1.15, the Slack Web API, Claude Code and Codex as of 2026-11-15.
- **Related:** [architecture](architecture.md), [operations](operations.md).

## 1. Herdr

### 1.1 Mod API

The mods import these names. The installed guide `~/.config/herdr-app/AGENTS.md` and the `.d.ts` files next to it describe them.

| Module      | Names                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpui-kit`  | `View`, `div`, `svg`, `image`                                                                                                                |
| `gpui-base` | `h_flex`, `v_flex`, `InputState`, `Input`, `TextareaState`, `Textarea`, `Scrollbar`, `ScrollHandle`, `TextView`                              |
| `herdr`     | `exec`, `hc`, `home`, `appHome`, `readTextFile`, `theme`, `layout`, `notify`, `run`, `props`, `shared`, `setShared`, `spaces`, `knownAgents` |
| Built-ins   | `fetch`, `localStorage`, `console.log`                                                                                                       |
| `cx`        | `cx.timer.every`, `cx.spawn`, `cx.notify`, `cx.focus_handle`, `cx.stop_propagation`, `cx.bind_keys`                                          |

Facts that the design relies on:

- A mod copy starts the first time it shows. It stays alive while its block is in the layout, shown or not.
- `setShared` draws every mod again.
- `localStorage` is separate for each mod copy.
- `fetch` takes `method`, `headers` and a string `body`. Its response has `status`, `ok`, `url`, `text()` and `json()`, but no response headers. So the mod cannot read `Retry-After`.
- `TextareaState` has no way to change its placeholder, so the panel makes one for each reply target. `set_auto_grow(1, 6)` grows it to 6 rows. `release()` frees it.
- The text input's own bindings for `enter`, `shift-enter` and `escape` are in the key context `Input`. A `cx.bind_keys` binding with the context `SlackReply > Input` matches at the same depth and comes later, so it wins. Escape goes on to the view's `on_key_down`.
- `exec` has a default timeout of 30 s. It returns `{code, stdout, stderr}`.
- `run` returns nothing, so it cannot report a failure. Send to agent uses `herdr-app do` through `exec` for that reason.
- `knownAgents()` gives the agents of the + menu: `key`, `name`, `icon`, `tint`, `run` (the argv) and `installed`. Codex's `run` is `codex --no-daemon`. It checks at most once a minute and rejects when the check fails.
- `image()` reads paths relative to `~/.config/herdr-app`. A save of a file under `mods/` reloads the mod.
- `TextView.markdown(id, text)` draws CommonMark, with strike (`~~`). `on_link_click` replaces its own link handler.
- Herdr's default UI font draws no bold and no italic, also through `font_weight` and `italic()`. The font family `.SystemUIFont` draws both, so the view sets it on its `TextView`.

### 1.2 Layout ids

| Id               | Used by                             | Why                                                                     |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `sidebar-footer` | `layout/main-slack.jq`              | The meter goes before it.                                               |
| `tabs`           | `layout/main-slack.jq`              | It becomes a row with the Slack button.                                 |
| `panel-body`     | `layout/main-slack.jq`, button copy | The Slack panel goes into this stack. `active` tells which child shows. |
| `panel`          | Button copy                         | `hidden` tells if the panel column shows.                               |
| `sidebar`        | Usage meter                         | `size.px` under 160 means the narrow rail form.                         |

### 1.3 Commands

| Command                                                                  | Used by      | Purpose                                                |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------ |
| `run("layout.select", {stack: "panel-body", child: "slack"})`            | Button copy  | Shows the Slack child in the panel stack.              |
| `run("layout.show", {id: "panel"})`, `run("layout.hide", {id: "panel"})` | Button copy  | Opens or closes the panel column.                      |
| `herdr-app do tab.new {space, name, argv, task}`                         | Panel copy   | Adds an agent tab to the space `space`.                |
| `herdr-app do space.new {name, folder, argv, task}`                      | Panel copy   | Makes the space `space` at `~/code` with an agent tab. |
| `herdr-app do layout.switch --name main-slack`                           | `install.sh` | Shows the new layout.                                  |
| `herdr-app check <mod folder>`                                           | `install.sh` | Loads a mod once and reports errors.                   |

- `herdr-app do` prints what it made. On failure it prints `{ "error": … }` and exits 1.
- `spaces()` gives the open spaces. Send to agent looks for a local space (`machine` null) named `space`.

### 1.4 herdr-core (`hc`)

The usage meter runs these for the probe:

| Command                                                                                 | Purpose                         |
| --------------------------------------------------------------------------------------- | ------------------------------- |
| `hc run --bg --no-notify --no-parent --name herdr-usage-probe --cwd ~/code -- claude …` | Starts the hidden probe.        |
| `hc wait herdr-usage-probe --timeout 120`                                               | Waits until the probe is idle.  |
| `hc get herdr-usage-probe --json`                                                       | Reads `state` and `created_ms`. |
| `hc kill herdr-usage-probe`, `hc rm herdr-usage-probe`                                  | Removes the probe.              |

- A terminal from `hc run` without a `herdr.space` label stays hidden.
- `--no-parent` keeps the probe out of the agents list as a sub-agent.

### 1.5 macOS programs

| Program                                                        | Used for                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `security`                                                     | Reads the token from the Keychain.                              |
| `curl`                                                         | Downloads images. Gets the token on stdin for Slack files.      |
| `ioreg`                                                        | `HIDIdleTime`: how long since the last keyboard or mouse input. |
| `open`                                                         | Opens a permalink in Slack.                                     |
| `sh`, `find`, `ls`, `tail`, `grep`, `sed`, `mkdir`, `mv`, `rm` | The Codex read and the image cache.                             |

## 2. Slack Web API

### 2.1 Methods and scopes

All calls send the user token in an `Authorization: Bearer` header. The reads are `GET https://slack.com/api/<method>`. The only write is `POST https://slack.com/api/chat.postMessage` with a JSON body.

| Method                  | Caller        | Parameters                                                    | Scopes                                                             |
| ----------------------- | ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `auth.test`             | Button        | None                                                          | None                                                               |
| `search.messages`       | Button        | `query`, `sort=timestamp`, `sort_dir=desc`, `count=50`        | `search:read`                                                      |
| `users.info`            | Button, panel | `user`                                                        | `users:read`                                                       |
| `conversations.info`    | Button, panel | `channel`                                                     | `channels:read`, `groups:read`, `im:read`, `mpim:read`             |
| `conversations.members` | Button        | `channel`, `limit=50`                                         | `mpim:read`                                                        |
| `conversations.history` | Panel         | `channel`, `limit`, `cursor`, `latest`, `oldest`, `inclusive` | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
|                         |               | Also for Send to agent to another agent than Claude           |                                                                    |
| `conversations.replies` | Panel         | `channel`, `ts`, `limit=200`, `cursor`                        | The same `*:history` scopes                                        |
| File thumbnail URLs     | Button, panel | `GET` on `thumb_360` (or the nearest size)                    | `files:read`                                                       |
| `chat.postMessage`      | Panel         | JSON: `channel`, `text`, `thread_ts` for a thread reply       | `chat:write`                                                       |

- The two search queries are `<@USER_ID>` (mentions) and `to:me` (DMs and group DMs). `USER_ID` comes from `auth.test`.
- `slack-app-manifest.yaml` asks for exactly the scopes in this table. All of them are read scopes except `chat:write`.
- `chat.postMessage` with a user token posts as that user. The body is `application/json; charset=utf-8`. The text goes as typed: Slack escapes `<`, `>` and `&` itself.
- Its answer has `ts` and `message`. The view shows that message at once.
- The app has no bot user, and token rotation is off, so the user token does not expire.

### 2.2 Fields the code reads

| Source                              | Fields                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.test`                         | `user_id`                                                                                                                                                                           |
| `search.messages`                   | `messages.matches[]`: `channel {id, name, is_im, is_mpim, user}`, `ts`, `user`, `username`, `text`, `permalink`, `attachments`, `blocks`, `files`, `icons`, `bot_id`, `bot_profile` |
| `users.info`                        | `user.name`, `user.real_name`, `user.profile.display_name`, `user.profile.real_name`, `user.profile.image_72`, `user.profile.image_48`                                              |
| `conversations.info`                | `channel.last_read`, `channel.name`, `channel.is_im`                                                                                                                                |
| `conversations.members`             | `members`                                                                                                                                                                           |
| `conversations.history`, `.replies` | `messages[]` (as above, plus `reply_count`, `reactions`, `user_profile`), `has_more`, `response_metadata.next_cursor`                                                               |

### 2.3 Message format

- Mrkdwn tokens: `<@U123|name>`, `<#C123|name>`, `<!here>`, `<!subteam^S123|@team>` and `<https://url|label>`. Search results keep typed angle brackets, such as `v<major>`, without escapes, so only these forms count as tokens.
- Entities: `&lt;`, `&gt;` and `&amp;`. The code decodes them last.
- Emoji: `:short_name:`, with an optional `:skin-tone-2:` to `:skin-tone-6:`. The names follow iamcal/emoji-data. Custom workspace emoji stay as `:name:` text, dimmed in the list.
- Formatting: `*bold*`, `_italic_`, `~strike~`, `` `code` `` and ` ``` ` code blocks. Quote lines start with `&gt;`. Bullet lines start with `•`, `◦`, `-` or `*`, and numbered lines with `1.` or `1)`.
- A marker opens after a start, a space or punctuation, and closes before an end, a space or punctuation. So `snake_case` and `2*3` stay literal.
- `mrkdwn()` maps these to CommonMark: `**bold**`, `*italic*`, `~~strike~~` and `[label](<url>)`. It changes nothing inside code, decodes the entities once, and escapes all other Markdown characters. A hard line break keeps each Slack line break.
- A reply's permalink has `?thread_ts=<ts>`. A top-level message's permalink does not.
- A group DM's name is `mpdm-ann--bea--chen-1`. The code shows it as `ann, bea, chen`.
- Bot messages often have an empty `text`. The code then takes the text from `attachments` (`pretext`, `title`, `text`, else `fallback`) or from `blocks`.
- GIPHY posts have an `image` block with a public `image_url`.

### 2.4 Errors

| Response                                                                                                             | Kind                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| HTTP 429, or `error: "ratelimited"`                                                                                  | `ratelimited`                         |
| `invalid_auth`, `not_authed`, `token_revoked`, `token_expired`, `account_inactive`, `missing_scope`, `no_permission` | `auth`                                |
| Any other `ok: false`                                                                                                | `api`, or skipped for a single lookup |
| `fetch` throws, or the body is not JSON                                                                              | `network`                             |

A failed reply shows one line over the composer:

| `chat.postMessage` error | Line in the view                                                              |
| ------------------------ | ----------------------------------------------------------------------------- |
| `missing_scope`          | Needs the chat:write permission: update the Slack app, see docs/deployment.md |
| `not_in_channel`         | You are not in this channel. Join it in Slack to reply.                       |
| `is_archived`            | This channel is archived. Slack does not take replies in it.                  |
| `channel_not_found`      | Slack cannot find this conversation.                                          |
| `restricted_action`      | A workspace setting stops you from posting here.                              |
| `msg_too_long`           | The message is too long for Slack. Make it shorter.                           |
| `ratelimited`, HTTP 429  | Slack rate limit. Wait a minute, then send again.                             |
| `fetch` throws           | Cannot reach Slack. Look in Slack before you send again.                      |

## 3. Claude Code status line

Claude Code passes a JSON object on stdin to the status-line command. The meter needs these fields:

| Field                                   | Meaning                            |
| --------------------------------------- | ---------------------------------- |
| `rate_limits.five_hour.used_percentage` | Percent of the 5-hour window used. |
| `rate_limits.five_hour.resets_at`       | Reset time, in Unix seconds.       |
| `rate_limits.seven_day.used_percentage` | Percent of the 7-day window used.  |
| `rate_limits.seven_day.resets_at`       | Reset time, in Unix seconds.       |

- Your status-line script writes `{"at": <unix seconds>, "rate_limits": <that object>}` to `~/.cache/herdr-slack/claude-usage.json` ([deployment](deployment.md#4-add-the-status-line-snippet)).
- The meter needs `rate_limits.five_hour` and a numeric `at`. Else it keeps its last good value.

The probe runs this command:

```sh
claude --model claude-haiku-5-5 --strict-mcp-config --disable-slash-commands \
  --tools "" --system-prompt "Reply with ok." "ok"
```

## 4. Codex session logs

Codex writes its session logs to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, one JSON object per line. The meter reads these fields:

| Field                                        | Meaning                                     |
| -------------------------------------------- | ------------------------------------------- |
| `timestamp`                                  | ISO time of the event. The newest one wins. |
| `payload.type`                               | Must be `token_count`.                      |
| `payload.rate_limits.primary.used_percent`   | Percent of the main window used.            |
| `payload.rate_limits.primary.window_minutes` | Window length. 10080 shows as `7d`.         |
| `payload.rate_limits.primary.resets_at`      | Reset time, in Unix seconds.                |
| `payload.rate_limits.secondary`              | A second window, or null. Shown when set.   |

- The meter reads the three newest logs that changed in the last 8 days.
- From each log, it reads only the last 400 lines, and the last 20 `token_count` lines of those.
