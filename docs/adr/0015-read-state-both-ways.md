# ADR 0015: Read state flows both ways

- **Status:** Accepted, 2026-11-16. Replaces one rule of [ADR 0006](0006-read-only-unread.md), [ADR 0011](0011-replies-from-the-conversation-view.md) and [ADR 0013](0013-thread-read-marks.md): the panel never calls `conversations.mark`.
- **Decided by:** Ajay, the owner of the project.

## Context

- Ajay's report: "Replying here doesn't remove the unread notification in Slack. Can we have it flowing both ways?"
- Read state flowed only from Slack to the panel. A conversation that you read or answered in the panel stayed unread in Slack.
- A reply with `chat.postMessage` does not clear the unread state in Slack. The conversation stays unread after a reply from the panel.
- `conversations.mark` sets your read position in a conversation to a `ts`. It needs the user scopes `channels:write`, `groups:write`, `im:write` and `mpim:write`. It can also move the position back, as "Mark unread" in Slack does.
- Slack has no documented method that marks a thread read.
- A check of existing threads did not show whether a reply that `chat.postMessage` posts as the user moves that thread's `last_read`. The live test (a thread reply from the panel) was skipped.

## Decision

- The panel calls `conversations.mark` at these times, under the "Mark read in Slack" switch:

  | Event                                           | Mark up to                                                                                                                  |
  | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | You open a DM or group DM                       | The newest message that the view loaded                                                                                     |
  | You open a channel mention outside a thread     | The newest message that the view showed. If more than 100 messages follow the mention, the view has a gap: the mention only |
  | A reply posts in a DM or group DM               | The `ts` of your reply                                                                                                      |
  | You open a thread, or a reply posts in a thread | No mark. A reply under a channel mention is a thread reply.                                                                 |

- Each mark obeys these rules:
  - Never past what the view showed.
  - Never back. Just before the mark, the panel reads Slack's current `last_read` with `conversations.info`. If it is at or past the `ts`, the panel skips the mark.
  - Repeat marks for one conversation within 10 s make one call, with the newest `ts`. So an open and a quick reply make one call.
  - Only the first load of a view marks. The 60 s reload and the refresh button do not, because the panel can be hidden while its view reloads.
- After a mark, the panel writes `shared("slack.marked")`. The button copy takes it into its read marks within 1 s, forward only. The list and the badge clear without a poll.
- The switch "Mark read in Slack" is under the gear. It is on by default and lives in `shared("slack.markRead")`. When it is off, nothing calls `conversations.mark`.
- A failed mark never blocks the view or the reply:
  - `missing_scope`: the settings show one line, "Needs write permission to mark read in Slack". The panel stops all marks until it reads the token from the Keychain again. A switch off and on also reads it again.
  - Any other error (`not_in_channel`, `channel_not_found`, `invalid_timestamp`, a rate limit, no network): the panel skips that mark.
  - The panel logs only the error code.
- The call is a form `POST` to `conversations.mark` with `channel` and `ts`. The token goes only in the `Authorization` header.
- The panel still posts only on an explicit Send, and never adds reactions.

## Alternatives

| Alternative                                        | Why it lost                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Keep the panel read-only for read state            | Each reply from the panel left the conversation unread in Slack. Ajay asked for both ways.          |
| Mark a channel up to its newest message            | Marks messages that you never saw in the panel.                                                     |
| Mark with the cached `last_read` only              | A cached value can be old. A mark behind Slack's real position moves it back.                       |
| Mark on each reload of an open view                | The view reloads also while the panel is hidden.                                                    |
| `subscriptions.thread.mark` or other private calls | Not documented. They can change at any time.                                                        |
| Update the local read marks before Slack says ok   | A failed mark (for example `missing_scope`) moves the mark back at the next poll and un-sees items. |

## Consequences

- A DM or group DM that you open or answer in the panel is read in Slack too.
- A channel mention that you open in the panel is read in Slack up to the last message in the view. Newer channel messages stay unread.
- Known limit: opening or replying to a thread in the panel does not mark it read in Slack. Whether a reply posted as you clears the thread in Slack was not verified. Read the thread in Slack to clear it there.
- The token can now change your read position in every conversation that you can read. [SECURITY.md](../../SECURITY.md) tells how the code limits this.
- An app from an older manifest has no write scopes. Each first mark after a token read fails with `missing_scope`. The rest of the panel works ([deployment](../deployment.md#6-update)).
- Each mark makes two Tier 3 calls: `conversations.info` and `conversations.mark`.
