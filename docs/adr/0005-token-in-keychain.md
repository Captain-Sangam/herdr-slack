# ADR 0005: The token is in the Keychain, and is sent only in a header or on stdin

- **Status:** Accepted, 2026-11-15.

## Context

- The mods need a Slack user token.
- A token in argv shows in `ps`. A token in a file, in `shared` or in `localStorage` stays on disk.
- Herdr's `fetch` takes request headers.

## Decision

- The token is a Keychain generic password with service `herdr-slack`.
- Each copy of the `slack` mod reads it with `security find-generic-password -s herdr-slack -w` and keeps it in instance memory only.
- API calls send it only in an `Authorization: Bearer` header through `fetch`.
- Slack file thumbnails need the token. A shell pipe reads it from the Keychain and gives it to `curl` as a config file on stdin (`curl -K -`).
- The setup check in the docs also gives the token to `curl` on stdin.
- On HTTP 429 or `error: ratelimited`, the poller waits 1 min, then doubles the wait up to 10 min. A success resets it.

## Alternatives

| Alternative                                                 | Why it lost                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| A config file with the token                                | The token stays on disk and can go into a commit.                 |
| A helper program that does the HTTP and reads `Retry-After` | One more program to guard, for a call rate that does not need it. |

## Consequences

- The token is never in argv, `shared`, `localStorage`, a file, a log, the agent task or the repo.
- `fetch` cannot read `Retry-After`, so the backoff is fixed.
- Processes of the same macOS user can still ask the Keychain for the token. They are trusted.
