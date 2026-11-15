# ADR 0008: Codex usage comes from its session logs

- **Status:** Accepted, 2026-11-15.

## Context

- Codex writes `token_count` events with `rate_limits` into its session logs, `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- A session that has just started has no `token_count` event yet, so the newest log alone is not enough.
- Logs can be large.

## Decision

- Every 60 s, the meter reads the three newest logs that changed in the last 8 days.
- From each log, it reads only the last 400 lines with `tail`, and the last 20 `token_count` lines of those.
- The newest event with `rate_limits.primary` wins. The meter also shows `secondary` when it is set.
- There is no Codex probe.

## Alternatives

| Alternative           | Why it lost                                |
| --------------------- | ------------------------------------------ |
| Start a Codex session | Costs a turn. The data is already on disk. |
| Read the whole log    | Slow for long sessions.                    |

## Consequences

- The Codex row needs no setup.
- If Codex did not run in the last 8 days, the row shows a dash.
- If Codex changes its log format, the row shows a dash until the parser changes.
