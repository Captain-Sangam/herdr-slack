# ADR 0003: The poller lives in the button copy

- **Status:** Accepted, 2026-11-15.

## Context

- The `slack` mod has two copies: the button in the tab bar and the panel in the panel stack.
- A mod copy starts the first time it shows. The panel column is hidden by default, so the panel copy does not run until the panel first opens.
- The badge on the button needs data at all times.
- `setShared` draws every mod again.

## Decision

- The button copy, which always shows, runs the poller every 60 s.
- It publishes the newest 150 items to `shared("slack.items")`, each preview at most 300 characters, and only when the list changed.
- It publishes `slack.status` and `slack.me` the same way.
- The panel copy only reads the shared items, draws them and acts on them.

## Alternatives

| Alternative                       | Why it lost                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Poll in the panel copy            | No badge and no data until the panel opens.                                   |
| Poll in both copies               | Twice the Slack calls.                                                        |
| A store at the module's top level | Herdr's guide says to keep instance state and host calls out of module scope. |

## Consequences

- One poller, one set of Slack calls, and the badge is right from the start.
- The items are in `shared.json` on disk ([architecture, privacy](../architecture.md#52-data-on-disk)).
- The conversation view needs more calls than the list. The panel copy makes them itself, with its own copy of the token.
