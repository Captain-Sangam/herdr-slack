# Testing

This page tells how herdr-slack is tested: the unit tests, the format check, `herdr-app check`, and the manual checks in a real Herdr window.

## 1. Test layers

| Layer         | Where                             | Runs                                  |
| ------------- | --------------------------------- | ------------------------------------- |
| Unit tests    | `test/*.test.mjs`                 | `npm test`. Local and CI.             |
| Format check  | `scripts/format.sh --check`       | Local, the pre-commit hook and CI.    |
| Mod check     | `herdr-app check <mod folder>`    | Local only. It needs Herdr.app.       |
| Window errors | `herdr-app status`                | Local only. It needs the open window. |
| Manual checks | A real Herdr window and Slack app | Local only, by hand.                  |

## 2. Commands

Run these before each commit:

```sh
npm test
scripts/format.sh --check
./install.sh
herdr-app check ~/.config/herdr-app/mods/slack
herdr-app check ~/.config/herdr-app/mods/usage-meter
herdr-app status | jq '{layout, errors}'
```

- `npm test` runs `node --test test/*.test.mjs`. Node 23 reads `node --test test/` as a module path, so the script names the files.
- `./install.sh` copies the mods into Herdr and also runs both checks.
- `herdr-app status` must show `"layout": "main-slack"` and `"errors": []`.

## 3. Unit tests

The pure logic is in `mods/slack/lib.js` and `mods/usage-meter/lib.js`. These files import nothing from Herdr, so Node runs them directly, and the mods import the same files. The tests use invented data only: ids such as `U0ME` and hosts such as `example.slack.com`.

| File                  | Area          | What the tests prove                                                                                                                                                                 |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/slack.test.mjs` | Timestamps    | Slack `ts` strings compare exactly, not as floats.                                                                                                                                   |
|                       | Filters       | Glob rules. Exclude wins. An empty include means all. Include never hides a DM. Exclude hides DMs by person or bot name and group DMs by name. A broken filter shows the item.       |
|                       | Text          | Mrkdwn to plain text, previews without formatting marks, typed angle brackets, entities, attachment and block text, emoji with skin tones, code spans and URLs left alone.           |
|                       | Formatting    | Mrkdwn to CommonMark: marks, `snake_case` and `2*3` literal, code untouched, entities decoded once, quotes, lists, line breaks, typed Markdown escaped, links, mentions.             |
|                       | Items         | Kinds, labels, names, the mention flag, the preview cap, the thread id from the permalink.                                                                                           |
|                       | Merge         | De-duplication by channel and `ts`. A flood in an excluded channel cannot push out a DM.                                                                                             |
|                       | Unread        | Read marks for conversations and threads, marks that move forward or back, the fetch order and starvation, rows and the badge, pruning, dismissed items.                             |
|                       | Backoff       | 60 s, doubling, at most 10 min.                                                                                                                                                      |
|                       | Send to agent | A tab in an open space, else a new space. A failed `herdr-app do` shows a toast and marks nothing seen.                                                                              |
|                       | Agent argv    | Claude with and without a model, Codex with `-m` after `--no-daemon`, another agent without a flag, an agent that is not installed, invalid models.                                  |
|                       | Agent context | Plain text with senders, times, link URLs, files and permalinks. The newest kept under the cap, the cut noted, marker lines changed. Only an agent other than Claude fetches it.     |
|                       | Images        | Avatar source, thumbnail size choice, the cache plan, GIPHY media fetched without the token.                                                                                         |
|                       | Rows and view | One row for each DM and thread. What a row opens. Thread titles, permalinks, line breaks, collapsed runs, reactions, group DM photos.                                                |
|                       | Replies       | The target for each view kind. Trim, empty refused, line breaks kept, nothing escaped. One JSON `POST` with a stub `fetch`, the token only in the header, no retry, each error line. |
| `test/usage.test.mjs` | Claude cache  | The cache parses. A torn read gives null.                                                                                                                                            |
|                       | Codex         | The newest `token_count` with `rate_limits` wins.                                                                                                                                    |
|                       | Display       | Unknown shows a dash. A passed reset shows `reset`. Stale data has an age.                                                                                                           |
|                       | Idle time     | `HIDIdleTime` from `ioreg` output.                                                                                                                                                   |
|                       | Probe         | Stale data and a Mac in use start a probe. One probe in 30 min. A click gets the wait.                                                                                               |

## 4. `herdr-app check`

`herdr-app check <mod folder>` loads a mod once and renders it. It exits nonzero with the exact error.

- **It cannot run in CI.** It needs Herdr.app, which runs only on a Mac. The CI runners are Linux and do not have Herdr.app.
- The check uses empty shared state in memory. It does not write `shared.json`.
- The check runs the mod's `init`. For the usage meter, this can start a probe if the Claude data is stale and the Mac is in use. The 5-minute sweep removes such a probe.
- A passed check does not prove that the mod looks right. Look at the window after each change.

## 5. Manual checks

Do these checks in a real Herdr window, with the Slack app and the token in place ([deployment](deployment.md)).

| Area              | Check                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout            | The meter is directly above Settings. The Slack button is right of Changes.                                                                                                                                                                       |
| Meter             | Claude 5h, Claude 7d and Codex each show a percent and a reset time. After a Claude turn, the values match the status line within 60 s.                                                                                                           |
| Rail              | With the sidebar narrower than 160 px, the meter shows only the percentages.                                                                                                                                                                      |
| Probe             | With the cache's `at` set back more than 60 min and the Mac in use, one probe runs and the file updates. Then `hc ls` shows no `herdr-usage-probe`. A click inside 30 min shows the wait.                                                         |
| Button            | The badge shows the unread count. A click opens and closes the panel. Each space keeps its own panel choice.                                                                                                                                      |
| New items         | A new DM, a group DM message and a channel mention show within 2 polls. A mention in an excluded channel does not show.                                                                                                                           |
| Read state        | A top-level message or DM that you read in Slack is read in the panel within 2 polls.                                                                                                                                                             |
| Conversation view | A DM opens its history. A thread opens the thread. Load older, "N replies", Back and Esc work.                                                                                                                                                    |
| Formatting        | Bold, italic, strike, code, a code block, a quote and a list show as in Slack. A link opens in the browser. A mention shows as a link. The list preview shows no `*` or `_`.                                                                      |
| Reply             | Do these checks only in a conversation where a test post is welcome. A DM reply goes to the DM. A thread reply goes to the thread. A reply to a channel mention outside a thread starts a thread under it and opens that thread.                  |
| Reply keys        | Enter sends. Shift+Enter adds a line. While a post runs, Enter and Send do nothing. Esc with text takes the focus off the composer. The next Esc leaves the view. Esc with an empty composer leaves the view.                                     |
| Reply result      | After a send, the composer is empty, the message shows at once, and the row is seen. A failed send keeps the text and shows one line. Without `chat:write`, the line says "Needs the chat:write permission".                                      |
| Drafts            | Type a draft, go back, open the same conversation again. The draft is there. A search for the draft text in `~/.config/herdr-app/shared.json` finds nothing.                                                                                      |
| Agent settings    | The gear shows the installed agents and the model field. Claude shows `claude-opus-5-5` and its suggestions. Codex shows its suggestions. Pi or OpenCode shows "model not supported for this agent". `a;b` shows an error and is not saved.       |
| Other agents      | With Codex chosen, a send starts `codex --no-daemon -m <model>`. Its first message has the conversation between `BEGIN SLACK DATA` and `END SLACK DATA`, and no token.                                                                            |
| Send to agent     | With the space `space` closed, a send makes it at `~/code` with a Claude tab. With it open, a send adds a tab. A failed send shows a toast and leaves the item unread.                                                                            |
| Send to space     | Pick an open space under the gear: a send adds a tab there. Rename it: the next send still goes there. "New space…" with `code` shows an error and is not saved. "Choose…" fills the folder. With the stored space closed, a send makes it again. |
| Errors            | No token, a revoked token, a rate limit and no network each show a clear message and keep the last items.                                                                                                                                         |
| Token             | `grep -r xoxp ~/.config/herdr-app` finds nothing. `ps -axww` during a poll shows no token.                                                                                                                                                        |

## 6. Screenshots for the docs

The repo is public. The images in `docs/assets/` must never show real Slack content, names, avatars, channel names or terminals.

- Render a temporary copy of a mod with invented data:
  1. Copy the mod to a scratch folder under `~/.config/herdr-app/mods/`, with `"place": "none"` and an `overlay` size in `mod.json`.
  2. Change the scratch copy so that it reads invented items from a local file. Remove every Slack call, post, Keychain read and probe from it. Stub `shared` and `setShared`, so that the copy never reads or writes the real `shared.json`.
  3. Run `herdr-app check` on the scratch copy.
  4. Open it with `herdr-app do mod.open --name <scratch name>`, take `herdr-app shot`, and run `mod.open` again to close it. Wait about 5 s before the shot: message images load after the first frame.
  5. Crop the overlay out of the shot. Remove metadata chunks from the PNG.
  6. Remove the scratch folder and its folder under `~/.config/herdr-app/data/`.
- Look at every image before you commit it.

### `preview.png` for herdr.dev

`preview.png` at the repo root is the picture on herdr.dev and at the top of the README. It is 2400 x 1500 px. It is not a screenshot. It shows a mockup of the `main-slack` window at 1.4 times the UI scale, with rounded corners and a soft shadow, on a dark gradient.

- **Real renders of the mods**, from invented data:
  - `preview-panel.png`: the conversation view of a thread, 368 x 774 px, with an image, reactions, a file and a typed draft in the composer. Make it with the scratch-copy method above, with an overlay of that size. Put the draft in the composer and set the composer's focus look.
  - `usage-meter.png` and `button.png`.
- **Drawn by the script**, with invented names and text:
  - the sidebar, with spaces and agents (working, done and idle)
  - the tab bar and the status bar
  - two agent panes: a Claude Code session that Send to agent started, and a Codex test run.
- **Colours:** from the screens (`panel.png` included) and from Herdr's default theme.
- **Labels:** three small pills in the margin point at Send to agent, the usage meter and the composer. `--no-labels` leaves them out.

1. Make the screens in `docs/assets/screens/` again first, if the mods changed.
2. Run the script. It needs macOS for the system fonts:

   ```sh
   uv run --with pillow==11.3.0 python scripts/preview.py
   ```

3. To compare, write a version without labels to another file: `scripts/preview.py --no-labels --out /tmp/plain.png`.
4. Look at `preview.png` at full size and at about 400 px wide before you commit it.
