# ADR 0001: Generate the layout from Herdr's `main.json`

- **Status:** Accepted, 2026-11-15.

## Context

- herdr-slack needs three changes to Herdr's main layout:
  - the meter above Settings
  - a Slack button in the tab bar
  - a Slack panel in the panel stack.
- Herdr replaces its shipped layouts on every start. Shipped layouts accept only click and look fields through `layout.set`, not structure.
- A new layout file is allowed. A cloned layout never gets Herdr's later changes.

## Decision

- `install.sh` builds `layouts/main-slack.json` from the current `layouts/main.json` with the jq patch `layout/main-slack.jq`, on every install.
- The patch needs the ids `sidebar-footer`, `tabs` and `panel-body`. If one is missing, `jq` stops with an error and writes nothing.
- The installer builds the file aside, checks both mods, and only then moves the file into place.

## Alternatives

| Alternative                          | Why it lost                                                 |
| ------------------------------------ | ----------------------------------------------------------- |
| `layout.clone` once and edit by hand | The copy stays at today's version and misses Herdr updates. |
| Edit `main.json`                     | Herdr replaces it on every start.                           |

## Consequences

- After a Herdr update that changes `main.json`, the user runs `./install.sh` again.
- If Herdr renames an id that the patch needs, the install fails safe: the old `main-slack.json` stays. Then the patch must change.
- The installer never writes `main.json` or a shipped mod.
