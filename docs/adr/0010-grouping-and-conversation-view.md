# ADR 0010: Rows by conversation, and a conversation view in the panel

- **Status:** Accepted, 2026-11-15. Replaces the first rule that the panel does not expand threads. [ADR 0011](0011-replies-from-the-conversation-view.md) adds a reply composer to the view.

## Context

- The first list showed one row for each message. A busy DM filled the list.
- To read a conversation, the user had to open Slack or send it to an agent.

## Decision

- The list shows one row for each DM or group DM conversation, and one row for each channel thread. A mention outside a thread is its own row.
- Tabs, the Unread toggle and the tab counts work on rows. The badge still counts messages.
- Dismiss covers every item in the row. Open and Send act on the newest item.
- A click on a row opens a read-only conversation view in the panel copy:
  - a DM or group DM: its history, newest 50, with Load older
  - a thread: `conversations.replies`, up to 5 pages
  - a mention outside a thread: 15 messages up to it and 10 after it, with the mention marked.
- "N replies" opens a thread on top of the view. Back and Esc close it.
- The view's messages stay in the panel copy's memory, never in `shared`.

## Alternatives

| Alternative               | Why it lost                         |
| ------------------------- | ----------------------------------- |
| One row for each message  | A busy conversation fills the list. |
| Open Slack for every read | Leaves Herdr for a quick read.      |

## Consequences

- The app needs the `*:history` scopes. Without them, the view says "Needs history permission" and the list still works.
- The view makes its own Slack calls from the panel copy, with its own copy of the token.
- The view loads again every 60 s while it is open.
