# ADR 0014: A setting for the space that Send to agent uses

- **Status:** Accepted, 2026-11-16. Replaces the fixed space name `space` and the fixed folder `~/code` of Send to agent.
- **Decided by:** Ajay, the owner of the project.

## Context

- Send to agent found its space by the name `space` only. If that space was not open, it made a new one at `~/code`.
- After a rename of that space, no space had the name `space`. So each send made a new space `space`.
- A change of the name or the folder needed a code edit.
- Herdr's `spaces()` gives each space an `id` that stays the same after a rename, and `machine` (null for this computer).
- `herdr-app do space.new` prints `{ "space", "tab", "terminal" }`, so the id of a new space is known.

## Decision

- The panel's settings section (the gear) has a "Send to space" control, under the agent and the model:
  - A chip for each open space on this computer, by name. A click stores the space's `id`, its current `name` and its `folder` (the home folder if the space has none).
  - A "New space…" chip. It shows two fields: a name (default `space`) and a folder (default `~/code`), with a "Choose…" button that opens `pickFolder()`. Enter, a lost focus or a chosen folder saves the pair, with no `id`.
- The setting is in `shared("slack.agent").space` as `{id, name, folder}`, next to `agent` and `model`. A change of the agent or the model keeps it.
- With no setting, the space is `space` at `~/code`, as before (`SPACE` in `lib.js`).
- `sendSpace()` in `lib.js` finds the target. Only spaces with `machine` null count.
  1. The space with the stored `id`, if it is open. A rename does not change the target.
  2. Else a space with the stored `name`.
  3. Else none. Send runs `mkdir -p` on the folder, then `space.new` with the stored name and folder.
- After a successful send, the panel saves the id of the space that it used, if it is not the stored id. This applies to a new space and to a space found by name. So a later rename keeps the target, and Send never makes a second space while the stored one is open.
- `expandFolder()` checks the folder: `~` and `~/…` go under the home folder, and the result must start with `/`. The panel does not save another folder, and Send refuses it with a toast.

## Alternatives

| Alternative                         | Why it lost                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Keep the name `space` as a constant | A rename makes a new space on each send. A change needs a code edit.                |
| Store only the name                 | A rename still breaks it.                                                           |
| Store only the id                   | A closed space cannot be made again, and the id of a closed space never comes back. |
| Use the shown space                 | A send would land in whatever space is shown at that moment.                        |
| Pick spaces on other machines too   | `space.new` and `mkdir` would need the machine. Not needed now.                     |

## Consequences

- Sends go to one space, also after a rename. If that space is closed, the next send makes it again with the stored name and folder, then stores the new id.
- If two open spaces have the stored name and the stored id is closed, the first one in `spaces()` order wins.
- A folder that is not a full path is never saved and never sent to `mkdir` or `space.new`.
- The space id is not secret. It lives in `shared.json` with the other settings.
