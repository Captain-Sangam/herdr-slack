# ADR 0006: Read-only unread state from `last_read`

- **Status:** Accepted, 2026-11-15. [ADR 0011](0011-replies-from-the-conversation-view.md) adds `chat:write` for replies, so the token is no longer read-only. [ADR 0013](0013-thread-read-marks.md) replaces the thread rule and the refresh rule: a thread reply uses its thread's `last_read`, and the poller fetches read marks least recently checked first. [ADR 0015](0015-read-state-both-ways.md) replaces the rule that the panel never calls `conversations.mark`: read state now flows both ways.

## Context

- The panel shows unread state, as Slack does.
- Slack's `conversations.info` gives `last_read` for a conversation with a user token.
- A thread reply does not move `last_read`.
- `conversations.mark` would need write scopes and would change Slack from a side panel.

## Decision

- A DM message or top-level channel message is read when its `ts` is at or before the conversation's `last_read`.
- The poller refreshes `last_read` for at most 10 conversations with unread top-level items in each poll. It keeps the values in `localStorage` across reloads.
- A thread reply stays unread until the user opens, sends or dismisses it in the panel.
- Seen ids live in `shared("slack.seen")`, pruned to the listed items, so both copies see them.
- The panel never calls `conversations.mark`.

## Alternatives

| Alternative                            | Why it lost                                        |
| -------------------------------------- | -------------------------------------------------- |
| `conversations.mark` with write scopes | Changes Slack and widens the token.                |
| Local seen state only                  | A message read in Slack stays unread in the panel. |

## Consequences

- The token stays read-only. The panel changes nothing in Slack.
- A thread reply read in Slack stays unread in the panel until it is opened there.
- After a reload, unread counts are right at once, because `last_read` is kept.
