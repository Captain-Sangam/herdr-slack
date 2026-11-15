# ADR 0009: Exclude also covers DMs

- **Status:** Accepted, 2026-11-15. Replaces the first rule that filters never hide DMs.

## Context

- The panel has include and exclude lists of patterns, stored in `shared("slack.filters")`.
- The first design never filtered DMs or group DMs, so that a person's message always showed.
- Bots and note-taker apps send DMs and join group DMs. The user wanted to hide them too.

## Decision

- Exclude applies to every item:
  - a channel by its name
  - a DM by the other person's or bot's display name, real name or handle
  - a group DM by its name string, such as `ann, bea, chen`.
- Include applies to channels only. It never hides a DM or a group DM. An empty include list means all channels.
- Exclude wins over include.
- A pattern matches the whole name, case-insensitive, with any leading `#` ignored. `*` is any run of characters and `?` is one character.
- A broken filter shows the item.

## Alternatives

| Alternative                  | Why it lost                                              |
| ---------------------------- | -------------------------------------------------------- |
| Keep DMs out of every filter | Bot DMs fill the list, and there is no way to hide them. |
| A separate list for people   | Two lists for one idea.                                  |

## Consequences

- `*notetaker*` hides every group DM that has a Notetaker bot in its name.
- A wide pattern such as `*a*` can hide real DMs. The filter hint in the panel says that exclude covers DMs.
- The poller keeps each person's real name and handle, so that a pattern can match them.
