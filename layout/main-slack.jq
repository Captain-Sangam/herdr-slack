# Builds layouts/main-slack.json from Herdr's current layouts/main.json.
# Run on every install, so Herdr's later changes to main.json carry over.
# A missing id stops it with an error and no output.
#
#   jq -f layout/main-slack.jq ~/.config/herdr-app/layouts/main.json

def need($id): if any(.. | objects; .id == $id) then . else error("main.json has no node \"\($id)\"") end;

def usage: { id: "usage", type: "block", size: { px: 100 }, content: { mod: "usage-meter" } };
def slack_button: { id: "slack-button", type: "block", size: { px: 104 }, window_drag: true,
                    content: { mod: "slack", props: { role: "button" } } };
def slack_panel: { id: "slack", type: "block", content: { mod: "slack", props: { role: "panel" } } };

need("sidebar-footer") | need("tabs") | need("panel-body")
| walk(
    if type == "object" and (.children | type) == "array" then
      .children |= map(
        if .id == "sidebar-footer" then usage, .
        # The tab bar becomes a row: Herdr's own tabs block, then the Slack button.
        elif .id == "tabs" then
          { id: "tabs-row", type: "row", size: .size, resizable: false,
            children: [ (.size = { weight: 1 }), slack_button ] }
        else . end)
      | if .id == "panel-body" then .children += [slack_panel] else . end
    else . end)
