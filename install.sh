#!/bin/sh
# Installs the usage-meter and slack mods and the main-slack layout into Herdr.app,
# then shows main-slack. Safe to rerun; rerun after a Herdr update changes main.json.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app="$HOME/.config/herdr-app"
cache="$HOME/.cache/herdr-slack"

mkdir -p "$cache"
cp -R "$here/mods/usage-meter" "$here/mods/slack" "$app/mods/"

# Build the layout aside; a missing id or a failed check leaves the old one in place.
tmp=$(mktemp "$cache/main-slack.json.XXXXXX")
trap 'rm -f "$tmp"' EXIT
jq -f "$here/layout/main-slack.jq" "$app/layouts/main.json" >"$tmp"

herdr-app check "$app/mods/usage-meter"
herdr-app check "$app/mods/slack"

chmod 644 "$tmp"
mv "$tmp" "$app/layouts/main-slack.json"
herdr-app do layout.switch --name main-slack
