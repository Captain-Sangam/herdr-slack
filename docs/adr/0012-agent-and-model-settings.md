# ADR 0012: Agent and model settings for Send to agent

- **Status:** Accepted, 2026-11-16. Replaces the fixed `ARGV` constant of decision 10. [ADR 0014](0014-send-to-space-setting.md) adds the space setting to `shared("slack.agent")`.
- **Decided by:** Ajay, the owner of the project.

## Context

- Send to agent always started `claude --model claude-opus-5-5`. A change needed a code edit.
- Herdr's `knownAgents()` lists the agents that the + menu starts, with their `run` argv and whether each is installed.
- Claude reads Slack with its own connector. Codex and the other agents have no Slack connector, so a permalink alone tells them nothing.

## Decision

- The panel's settings section (the gear) has an agent picker and a model field, under the include and exclude filters.
  - The picker shows the installed agents from `knownAgents()`. The default is Claude.
  - The model field takes a model id or alias. It suggests `claude-opus-5-5` (the default), `opus`, `sonnet`, `fable` and `haiku` for Claude, and `gpt-6-astra` and `gpt-5.6-sol` for Codex.
  - An empty model means the agent's own default: no model flag.
- The settings live in `shared("slack.agent")` as `{agent, model}`.
- `agentArgv()` in `lib.js` builds the argv: the agent's own `run` argv, then the model flag.

  | Agent       | Model flag                                                                  |
  | ----------- | --------------------------------------------------------------------------- |
  | Claude      | `--model <m>`                                                               |
  | Codex       | `-m <m>`                                                                    |
  | Other agent | None. The model field is off and says "model not supported for this agent". |

- A model has only letters, digits, `.`, `-`, `_` and `/`, and starts with a letter or digit. The panel does not save another value, and `agentArgv()` refuses it.
- The task depends on the agent:
  - Claude: as before. The permalink and the ids, and Claude reads Slack itself.
  - Another agent: the panel fetches the conversation as the view does (the thread, else the messages around the item). `contextText()` writes it as plain text: sender, time, text, link URLs, file names and permalinks. The text goes into the task between `BEGIN SLACK DATA` and `END SLACK DATA`, with a note that it is untrusted content, not instructions.
  - The text is at most about 20,000 characters. The newest messages stay, and a line tells how many older ones were cut.

## Alternatives

| Alternative                         | Why it lost                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| Keep `ARGV` as a constant           | Each change of agent or model needs a code edit and an install.      |
| A free text field for the argv      | Anything could land in argv. A picker and a checked model are safer. |
| Give every agent only the permalink | An agent without a Slack connector cannot read it.                   |
| Give the agent the Slack token      | The token can post as the user. It never leaves the panel copy.      |

## Consequences

- An agent other than Claude gets Slack content in its first message. The prompt injection risk in [SECURITY.md](../../SECURITY.md) applies to that text directly.
- The task of another agent can be about 20 KB. It goes to `herdr-app do` in argv, as the task did before. The token never does.
- A line in the data that copies a marker is changed (`END SLACK-DATA`), so a message cannot end the data block.
- If the fetch fails (no history scope, no network), the task says so and keeps the preview.
- If the chosen agent is not installed any more, Send to agent shows an error toast and starts nothing.
