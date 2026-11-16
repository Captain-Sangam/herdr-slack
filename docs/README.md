# herdr-slack docs

This folder holds the documentation of herdr-slack. Start with the architecture and the deployment. Use the other pages when you need them.

## Start here

| Doc                             | Read it to                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | Learn the components, the data flows, and the token and privacy model.                          |
| [Deployment](deployment.md)     | Set up the Slack app and the token, add the status-line snippet, install, update and uninstall. |

## Reference

| Doc                         | Read it to                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| [Interfaces](interfaces.md) | Check the Herdr, Slack, Claude Code and Codex facts that the code depends on.                      |
| [Operations](operations.md) | Fix a problem: no token, `missing_scope`, `ratelimited`, stale usage, the image cache, the layout. |
| [Testing](testing.md)       | Run the unit tests and the checks, do the manual checks, and make screenshots for the docs.        |

## Decisions (ADR)

| ADR                                                    | Decision                                                      | Status                          |
| ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------- |
| [0001](adr/0001-generate-layout.md)                    | Generate the layout from Herdr's `main.json` on each install. | Accepted                        |
| [0002](adr/0002-no-cloned-mods.md)                     | No shipped mod is cloned. The Slack button is its own block.  | Accepted                        |
| [0003](adr/0003-poller-in-button.md)                   | The poller lives in the button copy.                          | Accepted                        |
| [0004](adr/0004-two-searches.md)                       | Two `search.messages` calls for each poll.                    | Accepted                        |
| [0005](adr/0005-token-in-keychain.md)                  | The token is in the Keychain, sent in a header or on stdin.   | Accepted                        |
| [0006](adr/0006-read-only-unread.md)                   | Read-only unread state from `last_read`.                      | Accepted                        |
| [0007](adr/0007-haiku-usage-probe.md)                  | A Haiku probe refreshes stale Claude usage.                   | Accepted                        |
| [0008](adr/0008-codex-usage-from-logs.md)              | Codex usage comes from its session logs.                      | Accepted                        |
| [0009](adr/0009-exclude-covers-dms.md)                 | Exclude also covers DMs.                                      | Accepted, replaces a first rule |
| [0010](adr/0010-grouping-and-conversation-view.md)     | Rows by conversation, and a conversation view in the panel.   | Accepted, replaces a first rule |
| [0011](adr/0011-replies-from-the-conversation-view.md) | Replies from the conversation view, only on an explicit Send. | Accepted, replaces a first rule |
| [0012](adr/0012-agent-and-model-settings.md)           | Agent and model settings for Send to agent.                   | Accepted, replaces `ARGV`       |
| [0013](adr/0013-thread-read-marks.md)                  | Read marks for threads, fetched least recently checked first. | Accepted, replaces part of 0006 |
| [0014](adr/0014-send-to-space-setting.md)              | A setting for the space that Send to agent uses.              | Accepted, replaces `space`      |

To add a decision:

1. Copy an ADR and give it the next number.
2. Fill in the status, context, decision, alternatives and consequences.
3. Add a row to the table above.
4. Change the docs that describe the code, for example the architecture.

## Other places

- [`assets/`](assets/): the logo and the screenshots in the root README. They show invented data only.
- [`../slack-app-manifest.yaml`](../slack-app-manifest.yaml): the Slack app manifest.
- [`../AGENTS.md`](../AGENTS.md): the short guide for coding agents.
- [`../SECURITY.md`](../SECURITY.md): the security notes and how to report a problem.
