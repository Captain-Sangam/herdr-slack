# ADR 0002: No shipped mod is cloned, and the Slack button is its own block

- **Status:** Accepted, 2026-11-15.

## Context

- Herdr's `tabs` mod draws the Files and Changes buttons. They are hard-coded in its code.
- A cloned mod never gets Herdr's later changes.
- On macOS, Files and Changes are the last items in the tab bar, so a block to their right sits directly after them.
- `tabs` restores a space's open panel only if the panel id is in the shared list `workspace.panels`.

## Decision

- herdr-slack clones no shipped mod.
- The layout patch turns the `tabs` block into a row. The row holds Herdr's own `tabs` block, then a 104 px block `slack-button`. That block runs the `slack` mod with `role: "button"`.
- The button uses the same look as Files and Changes. It opens and closes the panel with `layout.select`, `layout.show` and `layout.hide`, as `tabs` does.
- The button copy adds `"slack"` to `workspace.panels` when it is missing.

## Alternatives

| Alternative                        | Why it lost                                   |
| ---------------------------------- | --------------------------------------------- |
| Clone `tabs` to add a third button | The tab bar loses Herdr's updates.            |
| Leave `workspace.panels` unchanged | The Slack panel closes on every space switch. |

## Consequences

- `tabs`, `workspace-chrome`, `files` and `changes` keep getting Herdr's updates.
- The button is a separate block, so its spacing can differ a little from Herdr's buttons.
- Uninstall removes `"slack"` from `workspace.panels` by hand ([deployment](../deployment.md#7-uninstall)).
