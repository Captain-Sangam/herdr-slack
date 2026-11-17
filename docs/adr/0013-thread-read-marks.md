# ADR 0013: Read marks for threads, fetched least recently checked first

- **Status:** Accepted, 2026-11-16. Replaces the thread rule and the refresh rule of [ADR 0006](0006-read-only-unread.md). The other rules of ADR 0006 stay. [ADR 0015](0015-read-state-both-ways.md) replaces the rule that the panel never calls `conversations.mark`.
- **Decided by:** Ajay, the owner of the project.

## Context

- A message that you read in Slack often stayed unread in the panel.
- A thread reply never used Slack's read state. It stayed unread until you opened it in the panel.
- The parent message in `conversations.replies` has `last_read` and `subscribed` for the user of the token, while that user follows the thread. A check on real data found `last_read` on 14 of 15 thread parents. It covered 25 of the 26 replies in the list.
- The poller refreshed `last_read` for the 10 newest conversations with unread top-level items. When more than 10 conversations had unread items, the older ones never got a refresh.
- The poller never refreshed a conversation with no unread item. So a "Mark unread" in Slack did not show in the panel.

## Decision

- Each item has a read mark:
  - a thread reply: its thread's `last_read`, from the parent message in `conversations.replies` with `limit=1`
  - any other item: its conversation's `last_read`, from `conversations.info`.
- An item is read when its `ts` is at or before its read mark. The newest value from Slack replaces the cached one, forward or back.
- Each poll fetches at most 20 read marks, least recently checked first.
  - A mark with an unread item comes first.
  - A mark with no unread item counts as checked 10 min later than it was. It is checked less often, but still is.
- If a mark moves back in Slack ("Mark unread"), the items that it makes unread leave `slack.seen`.
- The panel still never calls `conversations.mark` and never writes read state to Slack.

## Alternatives

| Alternative                              | Why it lost                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `client.counts` or other private methods | Not documented. They can change at any time.                                   |
| The thread's `unread_count`              | The parent message does not have it for this token.                            |
| A poll each 30 s                         | Two times the searches. The mark cap, not the poll interval, set the delay.    |
| A refresh of every mark in each poll     | Up to about 150 lookups in each poll, with 150 items. The rate limits are 50+. |

## Consequences

- A message that you read in Slack clears in the panel at the next poll, when no more than 20 marks have unread items. With up to 40, it clears within 2 polls.
- A thread that you do not follow in Slack has no `last_read`. Its replies stay unread until you open, send or dismiss them in the panel.
- A poll makes at most 20 read-mark lookups and 10 channel-name lookups. `conversations.info` and `conversations.replies` are Tier 3 methods (50+ calls each minute).
- `lastRead` in the button copy's storage also keeps thread marks, keyed `<channel id>:<thread ts>`.
