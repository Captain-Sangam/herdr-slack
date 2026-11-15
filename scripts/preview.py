# Builds preview.png, the herdr.dev picture of the main-slack layout: a mockup of the
# window on a dark backdrop. The Slack panel, the usage meter and the Slack button are
# real renders of the mods from invented data (docs/assets/screens/). The script draws
# the rest of the window (sidebar, tab bar, two agent panes, status bar) with invented
# names and text only. Colours come from the screens and Herdr's default theme.
# macOS only (system fonts).
#   uv run --with pillow==11.3.0 python scripts/preview.py [--no-labels] [--out FILE]
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "docs/assets/screens"
S = 2  # the screens are 2x renders; the window is drawn at 2x too
W, H = 1540, 860  # logical window size
SIDEBAR, PANEL, TABS, STATUS, METER, FOOTER = 268, 368, 42, 28, 100, 69
UI = 1.4  # final pixels per logical pixel, so text stays legible when the gallery shrinks it
OUT_W, OUT_H = 2400, 1500
LABELS = "--no-labels" not in sys.argv
OUT = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "preview.png"

panel = Image.open(SCREENS / "panel.png").convert("RGB")  # colours only
conversation = Image.open(SCREENS / "preview-panel.png").convert("RGB")
meter = Image.open(SCREENS / "usage-meter.png").convert("RGB")
button = Image.open(SCREENS / "button.png").convert("RGB")
top, bottom = TABS + 8, H - STATUS - 8
assert conversation.size == (PANEL * S, (bottom - top) * S), "render preview-panel.png at 368 x 774"


def brightest(img, box):
    return max(img.crop(box).getdata(), key=sum)


# Theme colours, sampled from the screens, and Herdr's default theme for the agent states.
chrome = meter.getpixel((20, 100))
background = panel.getpixel((12, 600))
border = next(panel.getpixel((300, y)) for y in range(150, 200) if sum(panel.getpixel((300, y))) > sum(background) + 20)
foreground = brightest(panel, (30, 30, 100, 60))
muted = brightest(panel, (140, 110, 240, 136))
dim = brightest(panel, (610, 296, 656, 318))
selected = panel.getpixel((32, 104))
accent = brightest(button, (130, 30, 160, 55))
WORKING, DONE, IDLE = (229, 192, 123), (118, 168, 255), (105, 106, 109)
GREEN, RED, CLAUDE = (166, 189, 145), (224, 108, 117), (217, 119, 87)

img = Image.new("RGB", (W * S, H * S), chrome)
d = ImageDraw.Draw(img)
ui = lambda px: ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", round(px * S))
mono = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", round(12.5 * S))
menlo = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", round(12.5 * S))  # for the Claude spinner glyph


def text(x, y, s, color, size=13, font=None):
    d.text((x * S, y * S), s, fill=color, font=font or ui(size))


def rect(x0, y0, x1, y1, fill=None, outline=None, radius=0, width=1):
    d.rounded_rectangle((x0 * S, y0 * S, x1 * S - 1, y1 * S - 1), radius * S, fill=fill, outline=outline, width=width * S)


def hline(x0, x1, y, color=None):
    d.rectangle((x0 * S, y * S, x1 * S - 1, y * S + S - 1), fill=color or border)


def ring(x, y, r, color, width=1.5):
    d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), outline=color, width=round(width * S))


def dot(x, y, r, color):
    d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), fill=color)


def spinner(x, y, r=5):
    d.arc(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), 200, 470, fill=WORKING, width=round(1.6 * S))


def status(kind, x, y):
    {"working": lambda: spinner(x, y), "done": lambda: dot(x, y, 3.5, DONE), "idle": lambda: ring(x, y, 3.5, IDLE)}[kind]()


# A terminal line: (text, colour) parts. "⏺" draws Claude Code's round bullet, which the
# system mono fonts lack; "✻", "☐" and "☒" come from Menlo.
def tline(x, y, parts):
    for s, color in parts:
        if s == "⏺":
            dot(x + 4, y + 8.5, 3.2, color)
            x += mono.getlength("  ") / S
            continue
        font = menlo if s in ("✻", "☐", "☒") else mono
        d.text((x * S, y * S), s, fill=color, font=font)
        x += font.getlength(s) / S


def lines(x, y, rows, step=20):
    for n, parts in enumerate(rows):
        tline(x, y + n * step, [(p, foreground) if isinstance(p, str) else p for p in parts])


# ── Sidebar: brand, spaces, agents, usage meter, Settings ──
d.rectangle((SIDEBAR * S, 0, SIDEBAR * S + S - 1, H * S), fill=border)
rect(14, 13, 34, 33, fill=accent, radius=5)
text(42, 14, "Herdr", foreground, 13.5)
ring(224, 22, 5, muted, 1)  # search
d.line(((228 * S, 26 * S), (232 * S, 30 * S)), fill=muted, width=S)
rect(240, 15, 254, 29, outline=muted, radius=3)  # sidebar toggle
text(14, 58, "Spaces", dim, 11)
spaces = [("S", "space", (120, 150, 210), True), ("A", "api", (110, 170, 190), False), ("W", "web-app", (190, 140, 110), False), ("I", "infra", (120, 170, 130), False), ("D", "docs", (170, 130, 180), False), ("M", "mobile", (200, 160, 100), False)]
for n, (initial, name, tile, active) in enumerate(spaces):
    y = 76 + n * 28
    if active:
        rect(8, y - 3, SIDEBAR - 8, y + 22, fill=selected, radius=7)
    rect(16, y + 1, 32, y + 17, fill=tile, radius=4)
    text(20.5, y + 1.5, initial, (255, 255, 255), 11)
    text(40, y, name, foreground if active else muted, 13)
text(14, 262, "Agents", dim, 11)
agents = [
    ("space", "slack Bea Kim", "working", CLAUDE),
    ("space", "webhook tests", "done", (120, 140, 230)),
    ("api", "refactor auth", "working", CLAUDE),
    ("web-app", "review PR 212", "done", CLAUDE),
    ("infra", "plan upgrade", "idle", CLAUDE),
    ("docs", "release notes", "idle", (120, 140, 230)),
]
for n, (space, task, state, tile) in enumerate(agents):
    y = 282 + n * 28
    if n == 0:
        rect(8, y - 4, SIDEBAR - 8, y + 21, fill=selected, radius=7)
    rect(18, y + 2, 30, y + 14, fill=tile, radius=3)
    text(38, y, f"{space} · {task}", foreground if n == 0 else muted, 12.5)
    status(state, SIDEBAR - 22, y + 8.5)
meter_top = H - FOOTER - METER
img.paste(meter.crop((6, 6, 530, 194)), (6, meter_top * S + 6))
hline(0, SIDEBAR, meter_top)
hline(0, SIDEBAR, H - FOOTER)
ring(25, H - FOOTER + 18, 6, muted, 1)  # Settings
ring(25, H - FOOTER + 18, 2, muted, 1)
text(42, H - FOOTER + 10, "Settings", muted, 13)
text(19, H - FOOTER + 37, "+", dim, 14)
text(42, H - FOOTER + 38, "Add machine", dim, 13)

# ── Tab bar: tabs, +, Files, Changes, the Slack button ──
left = SIDEBAR + 1
hline(left, W, TABS - 1)
x = left + 10
for n, name in enumerate(["slack Bea Kim", "notes", "shell"]):
    width = 26 + len(name) * 7
    if n == 0:
        rect(x, 7, x + width, 36, fill=selected, outline=border, radius=7)
    text(x + 13, 13, name, foreground if n == 0 else muted, 12.8)
    x += width + 3
slack_x = W - 104
img.paste(button.crop((4, 4, button.width - 4, button.height - 4)), (slack_x * S + 4, 4))  # without its overlay frame
text(slack_x - 228, 13, "+", muted, 15)
rect(slack_x - 196, 14, slack_x - 186, 28, outline=muted, radius=2)  # Files
text(slack_x - 180, 13, "Files", muted, 12)
ring(slack_x - 112, 16, 2.5, muted, 1)  # Changes
ring(slack_x - 104, 26, 2.5, muted, 1)
text(slack_x - 96, 13, "Changes", muted, 12)

# ── Body: two agent panes, and the Slack panel's conversation view ──
panel_x = W - 8 - PANEL
img.paste(conversation, (panel_x * S, top * S))
split = left + 8 + 530


def pane(x0, x1, title, state, focused):
    rect(x0, top, x1, bottom, fill=background, outline=accent if focused else border, radius=10)
    hline(x0 + 1, x1 - 1, top + 30)
    status(state, x0 + 18, top + 15)
    text(x0 + 30, top + 7, title, muted, 12)


# Left: the Claude Code session that Send to agent started from the thread in the panel.
x0, x1 = left + 8, split
pane(x0, x1, "Claude Code  ·  ~/code", "working", True)
rect(x0 + 14, top + 44, x1 - 14, top + 100, outline=CLAUDE, radius=6)  # the welcome box
lines(x0 + 26, top + 52, [[("✻", CLAUDE), " Welcome to Claude Code!"], [("   cwd: ~/code", dim)]], 22)
q = lambda s: (s, muted)
lines(
    x0 + 18,
    top + 116,
    [
        [(">", dim), q(" A Slack message needs my attention. Use your Slack tools")],
        [q("  (the claude.ai Slack connector) to get the full context.")],
        [q("  Permalink: https://example.slack.com/archives/C0BACKEND/")],
        [q("  p1763331000000400?thread_ts=1763329680.000100")],
        [q("  Conversation: #eng-backend (channel id C0BACKEND)")],
        [q("  From: Bea Kim")],
        [q("  Preview: @Sam Ortiz can you check the timeout part? …")],
        [],
        [("⏺", GREEN), ("slack - read_thread", foreground), (' (MCP)(channel: "C0BACKEND")', muted)],
        [("  └ 7 messages from Bea Kim, Chen Wu and Eli Novak", dim)],
        [],
        [("⏺", GREEN), ("slack - read_file", foreground), (' (MCP)(name: "retry-plan.md")', muted)],
        [("  └ Read 48 lines", dim)],
        [],
        [("⏺", GREEN), ("Read", foreground), ("(api/src/webhook/retry.ts)", muted)],
        [("  └ Read 112 lines", dim)],
        [],
        [("⏺", foreground), "Bea asks you to check how the retry treats timeouts."],
        ["  The plan counts a 504 as a failure, so it retries 3 times."],
        ["  retry.ts sets no timeout on the request, so a slow hook"],
        ["  can wait 30 s for each try. I will add one and a test."],
        [],
        [("⏺", GREEN), ("Update Todos", foreground)],
        [("  └ ", dim), ("☒", dim), (" Read the thread, the plan and retry.ts", dim)],
        [("    ", dim), ("☐", muted), (" Add a 10 s timeout to the hook request", foreground)],
        [("    ", dim), ("☐", muted), (" Add a test for a 504 timeout", foreground)],
        [],
        [("✻", CLAUDE), (" Tracing the timeout path…", CLAUDE), (" (38s · esc to interrupt)", dim)],
    ],
)
rect(x0 + 14, bottom - 62, x1 - 14, bottom - 30, outline=dim, radius=6)  # the prompt box
lines(x0 + 26, bottom - 54, [[(">", muted)]])
lines(x0 + 18, bottom - 24, [[("  ? for shortcuts", dim)]])

# Right, smaller: Codex, done with a test run.
x0, x1 = split + 8, panel_x - 8
pane(x0, x1, "Codex  ·  ~/code/web-app", "done", False)
rect(x0 + 14, top + 44, x1 - 14, top + 118, outline=dim, radius=6)
lines(x0 + 26, top + 52, [[(">_", dim), " OpenAI Codex"], [("model: ", dim), ("gpt-6-astra", muted)], [("directory: ", dim), ("~/code/web-app", muted)]])
ok = lambda s: [("      ✓ ", GREEN), (s, muted)]
lines(
    x0 + 18,
    top + 134,
    [
        [("› ", dim), "Why does the retry test time out?"],
        [],
        [("• ", dim), ("Read", foreground), (" test/webhook.test.ts", muted)],
        [("• ", dim), "The test waits 100 ms, but the first"],
        ["  backoff step is now 1 s. I will make"],
        ["  the test wait for the backoff."],
        [("• ", dim), ("Edited", foreground), (" test/webhook.test.ts ", muted), ("+18", GREEN), (" -2", RED)],
        [],
        [("› ", dim), "Run the webhook tests."],
        [],
        [("• ", dim), ("Ran", foreground), (" npm test -- webhook", muted)],
        [("  └ ", dim), ("PASS", GREEN), (" test/webhook.test.ts", muted)],
        ok("retries a failed request"),
        ok("backs off 1 s, 2 s, then 4 s"),
        ok("stops after the fourth try"),
        ok("keeps the request id"),
        ok("treats a 504 as a failure"),
        [("    Tests: ", muted), ("14 passed", GREEN), (", 14 total", muted)],
        [("    Time:  1.82 s", muted)],
        [],
        [("─ Worked for 1m 42s ──────────────────", dim)],
        [],
        [("• ", dim), "All 14 webhook tests pass. One"],
        ["  file changed: test/webhook.test.ts."],
    ],
)
rect(x0 + 14, bottom - 62, x1 - 14, bottom - 30, outline=dim, radius=6)
lines(x0 + 26, bottom - 54, [[("›", muted)]])
lines(x0 + 18, bottom - 24, [[("  ⏎ send  ·  ⌃C quit", dim)]])

# ── Status bar ──
hline(left, W, H - STATUS)
text(left + 12, H - STATUS + 7, "This computer  ·  main  ·  6 agents", muted, 11.5)
text(W - 104, H - STATUS + 7, "Cmd-P commands", dim, 11.5)

# ── The frame: the window, scaled, with rounded corners and a soft shadow, on a dark
# gradient with a hint of the accent ──
win_w, win_h = round(W * UI), round(H * UI)
mx, my = (OUT_W - win_w) // 2, (OUT_H - win_h) // 2
window = img.resize((win_w, win_h), Image.LANCZOS)


def blend(c0, c1, mask):
    return Image.composite(Image.new("RGB", (OUT_W, OUT_H), c1), Image.new("RGB", (OUT_W, OUT_H), c0), mask)


down = Image.linear_gradient("L").resize((OUT_W, OUT_H), Image.BICUBIC)
across = Image.linear_gradient("L").rotate(90).resize((OUT_W, OUT_H), Image.BICUBIC)
out = blend((9, 11, 16), (20, 24, 33), ImageChops.add(down, across, scale=2))


def glow(color, center, size, strength):
    # radial_gradient is 255 at the corners (about 180 at the rim): fade to 0 at the rim.
    fade = Image.radial_gradient("L").point(lambda v: round(max(0, 1 - v / 180.3) ** 1.6 * 255 * strength))
    mask = fade.resize(size, Image.BICUBIC)
    full = Image.new("L", (OUT_W, OUT_H), 0)
    full.paste(mask, (center[0] - size[0] // 2, center[1] - size[1] // 2))
    return Image.composite(Image.new("RGB", (OUT_W, OUT_H), color), out, full)


out = glow(accent, (OUT_W - 420, 360), (2000, 1500), 0.22)
out = glow(CLAUDE, (360, OUT_H - 200), (1700, 1200), 0.10)

radius = 18
shape = Image.new("L", (OUT_W, OUT_H), 0)
ImageDraw.Draw(shape).rounded_rectangle((mx, my, mx + win_w - 1, my + win_h - 1), radius, fill=255)
for blur, dy, alpha in ((60, 34, 0.75), (14, 8, 0.55)):
    shadow = Image.new("L", (OUT_W, OUT_H), 0)
    shadow.paste(shape.crop((0, 0, OUT_W, OUT_H - dy)), (0, dy))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: round(v * alpha))
    out = Image.composite(Image.new("RGB", (OUT_W, OUT_H), (0, 0, 0)), out, shadow)
canvas = Image.new("RGB", (OUT_W, OUT_H))
canvas.paste(window, (mx, my))
out = Image.composite(canvas, out, shape)
over = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
o = ImageDraw.Draw(over)
o.rounded_rectangle((mx, my, mx + win_w - 1, my + win_h - 1), radius, outline=(255, 255, 255, 34), width=2)

# Pill labels in the margin, each with a thin line to its feature (window coordinates in
# logical pixels).
at = lambda x, y: (round(mx + x * UI), round(my + y * UI))
pill_font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 34)
pill_font.set_variation_by_name("Medium")


def pill(label, cx, cy, target):
    w = pill_font.getlength(label) + 78
    box = (cx - w / 2, cy - 29, cx + w / 2, cy + 29)
    tx, ty = target
    edge = box[3] if ty > cy else box[1]
    o.line(((cx, edge), (tx, ty)), fill=accent + (150,), width=3)
    o.ellipse((tx - 9, ty - 9, tx + 9, ty + 9), fill=(16, 18, 24, 255), outline=accent + (230,), width=3)
    o.rounded_rectangle(box, 29, fill=(26, 30, 40, 235), outline=(255, 255, 255, 46), width=2)
    o.ellipse((box[0] + 25, cy - 6, box[0] + 37, cy + 6), fill=accent + (255,))
    o.text((box[0] + 52, cy), label, font=pill_font, fill=(232, 235, 240, 255), anchor="lm")


if LABELS:
    tab = at(left + 10 + (26 + 13 * 7) / 2, 7)  # the tab that Send to agent opened
    pill("Send to agent", tab[0], my // 2, tab)
    pill("Claude + Codex usage", at(SIDEBAR / 2, 0)[0], my + win_h + my // 2, at(SIDEBAR / 2, meter_top + 84))
    pill("Reply from Herdr", at(panel_x + PANEL / 2, 0)[0], my + win_h + my // 2, at(panel_x + PANEL / 2, bottom - 7))
out = Image.alpha_composite(out.convert("RGBA"), over).convert("RGB")
out.save(OUT, optimize=True)
print(f"{OUT.name} {OUT_W}x{OUT_H}, {OUT.stat().st_size // 1024} KB, labels: {LABELS}")
