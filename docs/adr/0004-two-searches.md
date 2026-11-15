# ADR 0004: Two `search.messages` calls for each poll

- **Status:** Accepted, 2026-11-15.

## Context

- The panel lists DMs, group DMs and mentions of the user.
- Slack search finds DM and group DM messages with `to:me`, also when they have no mention.
- Slack search finds mentions in channels and DMs with `<@USER_ID>`.

## Decision

- Each poll runs two `search.messages` calls: `<@USER_ID>` and `to:me`, with `sort=timestamp`, `sort_dir=desc` and `count=50`.
- `USER_ID` comes from `auth.test` for the stored token. No search runs before it is known.
- There is no pagination. The poller merges the matches with the old list and removes duplicates by channel id and `ts`.

## Alternatives

| Alternative                                  | Why it lost                                           |
| -------------------------------------------- | ----------------------------------------------------- |
| `conversations.history` for each DM, in turn | Many calls, and `*:history` scopes for the same data. |
| Pagination of the search results             | More calls for a case that has not happened.          |

## Consequences

- The list needs only the `search:read` scope, plus `*:read` scopes for names and `last_read`.
- If more than 50 matches arrive in one minute, the panel misses some. Add pagination if this happens.
- User-group and `@here` mentions are not in the list.
