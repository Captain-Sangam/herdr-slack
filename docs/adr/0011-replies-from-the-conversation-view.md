# ADR 0011: Replies from the conversation view

- **Status:** Accepted, 2026-11-16. Replaces the rule that the panel never posts to Slack (ADR 0006, ADR 0010). [ADR 0015](0015-read-state-both-ways.md) replaces the rule that read marks stay out: the panel now calls `conversations.mark`.
- **Decided by:** Ajay, the owner of the project.

## Context

- The panel showed DMs, mentions and threads, but an answer needed the Slack app.
- A short answer to a DM or a thread is the most frequent next step after a read.
- The first design kept the token read-only. The panel could not post, react or mark messages read.

## Decision

- The conversation view has a composer at the bottom. A reply posts in Slack as the user.
- A post goes out only from an explicit Send: the Send button, or Enter in the composer.
- The reply goes here:

  | View                             | Reply goes to                                                      |
  | -------------------------------- | ------------------------------------------------------------------ |
  | DM or group DM                   | The conversation                                                   |
  | Thread                           | The thread (`thread_ts` is the root)                               |
  | Channel mention outside a thread | A new thread under the mentioned message (`thread_ts` is its `ts`) |

- The call is `chat.postMessage` with a JSON body: `channel`, `text`, and `thread_ts` when needed. The token goes only in the `Authorization` header.
- One post runs at a time. Nothing retries a post. A failed post keeps the text and shows Slack's error on one line.
- Each view keeps its own draft in the panel copy's memory. Drafts never go into `shared`.
- The app gets one more user scope: `chat:write`.
- Reactions and read marks stay out. The panel still never calls `reactions.add` or `conversations.mark`.

## Alternatives

| Alternative                         | Why it lost                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Stay read-only, open Slack to reply | A context switch for each short answer.                                  |
| A bot user that posts               | The reply must come from the user, not from a bot.                       |
| Send on Cmd+Enter only              | Slack sends on Enter. The same keys in both places cause fewer mistakes. |
| Retry a failed post                 | A post that timed out can still arrive. A retry can post twice.          |

## Consequences

- The token can now post as the user in every conversation that the user can post in. [SECURITY.md](../../SECURITY.md) tells how the code limits this.
- An app from an older manifest has no `chat:write`. Each post then fails with `missing_scope`, and the view says how to fix it. The rest of the panel works.
- Send to agent does not change. The agent task never holds the token, and the agent cannot use the panel's composer.
