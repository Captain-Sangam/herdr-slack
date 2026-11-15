# ADR 0007: A Haiku probe refreshes stale Claude usage

- **Status:** Accepted, 2026-11-15.

## Context

- Claude Code gives its rate limits only to the status-line command, and only when a session draws its status line.
- A status-line script can write them to a cache file with shell builtins, at no extra process cost.
- When no Claude session runs, the cache gets old.

## Decision

- The status-line script writes `{"at", "rate_limits"}` to `~/.cache/herdr-slack/claude-usage.json`. The meter reads it every 60 s.
- The meter starts a probe in two cases:
  - automatically, when the cache is older than 60 min and the Mac was in use in the last 10 min (`ioreg` `HIDIdleTime`)
  - manually, when the user clicks the meter.
- Both cases share a limit of one probe in 30 min. A click inside that time shows when the next probe is allowed.
- The probe is `hc run --bg --no-notify --no-parent --name herdr-usage-probe` with `claude --model claude-haiku-5-5 --strict-mcp-config --disable-slash-commands --tools "" --system-prompt "Reply with ok." "ok"`.
- The meter waits up to 120 s for idle, then runs `hc kill` and `hc rm`. A probe older than 5 min is removed before a new one starts.

## Alternatives

| Alternative                        | Why it lost                             |
| ---------------------------------- | --------------------------------------- |
| Read `/usage` from the terminal UI | Brittle: the screen format can change.  |
| A 5-minute staleness limit         | Up to 96 probes a day.                  |
| Wrap the status-line command       | One more program and a settings change. |

## Consequences

- Each probe uses a one-word Haiku turn with no tools.
- The idle check stops probes at night. The cooldown stops a failing probe from a retry every minute.
- The probe never shows as a tab, because it has no `herdr.space` label.
- `herdr-app check` runs `init`, so it can start a probe. The 5-minute sweep removes it.
