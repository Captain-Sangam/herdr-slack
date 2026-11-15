# Builds preview.png, the herdr.dev picture of the main-slack layout, from the
# invented-data screens in docs/assets/screens/. The panel shows the conversation
# view, with its composer at the bottom of the panel. It draws the rest of the window
# (sidebar, tab bar, terminal card, status bar) with invented names and text only.
# Colours come from the screens. macOS only (system fonts).
#   uv run --with pillow==11.3.0 python scripts/preview.py
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "docs/assets/screens"
S = 2  # the screens are 2x renders; compose at 2x, save at 1x
W, H = 1600, 1000  # logical window size
SIDEBAR, PANEL, TABS, STATUS, METER, FOOTER = 268, 368, 42, 28, 100, 69

panel = Image.open(SCREENS / "panel.png").convert("RGB")  # colours only
conversation = Image.open(SCREENS / "conversation.png").convert("RGB")
COMPOSER = 120  # 2x rows at the bottom of conversation.png: the composer
meter = Image.open(SCREENS / "usage-meter.png").convert("RGB")
button = Image.open(SCREENS / "button.png").convert("RGB")


def brightest(img, box):
    region = img.crop(box)
    return max(region.getdata(), key=sum)


# Theme colours, sampled from the screens.
chrome = meter.getpixel((20, 100))
background = panel.getpixel((12, 600))
border = next(panel.getpixel((300, y)) for y in range(150, 200) if sum(panel.getpixel((300, y))) > sum(background) + 20)
foreground = brightest(panel, (30, 30, 100, 60))
muted = brightest(panel, (140, 110, 240, 136))
dim = brightest(panel, (610, 296, 656, 318))
selected = panel.getpixel((32, 104))
accent = brightest(button, (130, 30, 160, 55))

img = Image.new("RGB", (W * S, H * S), chrome)
d = ImageDraw.Draw(img)
ui = lambda px: ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", px * S)
mono = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", 13 * S)


def text(x, y, s, color, size=13, font=None):
    d.text((x * S, y * S), s, fill=color, font=font or ui(size))


def rect(x0, y0, x1, y1, fill=None, outline=None, radius=0):
    d.rounded_rectangle((x0 * S, y0 * S, x1 * S - 1, y1 * S - 1), radius * S, fill=fill, outline=outline, width=S)


def hline(x0, x1, y):
    d.rectangle((x0 * S, y * S, x1 * S - 1, y * S + S - 1), fill=border)


def ring(x, y, r, color):
    d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), outline=color, width=S)


# ── Sidebar: brand, spaces, agents, usage meter, Settings ──
d.rectangle((SIDEBAR * S, 0, SIDEBAR * S + S - 1, H * S), fill=border)
rect(14, 13, 34, 33, fill=accent, radius=5)
text(42, 14, "Herdr", foreground, 13.5)
ring(224, 22, 5, muted)  # search
d.line(((228 * S, 26 * S), (232 * S, 30 * S)), fill=muted, width=S)
rect(240, 15, 254, 29, outline=muted, radius=3)  # sidebar toggle
text(14, 58, "Spaces", dim, 11)
spaces = [("A", "api", (110, 150, 200), True), ("W", "web-app", (190, 140, 110), False), ("I", "infra", (120, 170, 130), False), ("D", "docs", (170, 130, 180), False)]
for n, (initial, name, tile, active) in enumerate(spaces):
    y = 76 + n * 28
    if active:
        rect(8, y - 3, SIDEBAR - 8, y + 22, fill=selected, radius=7)
    rect(16, y + 1, 32, y + 17, fill=tile, radius=4)
    text(20, y + 1, initial, (255, 255, 255), 11)
    text(40, y, name, foreground if active else muted, 13)
text(14, 206, "Agents", dim, 11)
agents = [("api", "retry fix", "working"), ("web-app", "review PR", "done"), ("infra", "plan upgrade", "idle")]
dots = {"working": accent, "done": (120, 190, 130), "idle": dim}
for n, (space, task, status) in enumerate(agents):
    y = 226 + n * 26
    rect(18, y + 3, 30, y + 15, fill=(214, 120, 90), radius=3)
    text(38, y, f"{space} · {task}", foreground if n == 0 else muted, 12.5)
    d.ellipse(((SIDEBAR - 24) * S, (y + 5) * S, (SIDEBAR - 16) * S, (y + 13) * S), fill=dots[status])
meter_top = H - FOOTER - METER
img.paste(meter.crop((6, 6, 530, 194)), (6, meter_top * S + 6))
hline(0, SIDEBAR, meter_top)
hline(0, SIDEBAR, H - FOOTER)
ring(25, H - FOOTER + 18, 6, muted)  # Settings
ring(25, H - FOOTER + 18, 2, muted)
text(42, H - FOOTER + 10, "Settings", muted, 13)
text(19, H - FOOTER + 37, "+", dim, 14)
text(42, H - FOOTER + 38, "Add machine", dim, 13)

# ── Tab bar: tabs, +, Files, Changes, the Slack button ──
left = SIDEBAR + 1
hline(left, W, TABS - 1)
x = left + 10
for n, name in enumerate(["retry fix", "tests", "shell"]):
    width = 22 + len(name) * 7
    if n == 0:
        rect(x, 7, x + width, 36, fill=selected, outline=border, radius=7)
    text(x + 11, 13, name, foreground if n == 0 else muted, 12.8)
    x += width + 3
slack_x = W - 104
img.paste(button.crop((4, 4, button.width - 4, button.height - 4)), (slack_x * S + 4, 4))  # without its overlay frame
hline(left, W, TABS - 1)
text(slack_x - 228, 13, "+", muted, 15)
rect(slack_x - 196, 14, slack_x - 186, 28, outline=muted, radius=2)  # Files
text(slack_x - 180, 13, "Files", muted, 12)
ring(slack_x - 112, 16, 2.5, muted)  # Changes
ring(slack_x - 104, 26, 2.5, muted)
text(slack_x - 96, 13, "Changes", muted, 12)

# ── Body: the terminal card and the Slack panel ──
top, bottom = TABS + 8, H - STATUS - 8
panel_x = W - 8 - PANEL
rect(left + 8, top, panel_x - 8, bottom, fill=background, outline=accent, radius=10)
hline(left + 9, panel_x - 9, top + 30)
text(left + 22, top + 8, "Claude Code  ·  ~/code/api", muted, 12)
lines = [
    ("> Fix the retry test in src/client.test.js", foreground),
    ("", None),
    ("● Read src/client.js and src/client.test.js", muted),
    ("● The test waits 100 ms, but the backoff now starts at 200 ms.", muted),
    ("● Edit src/client.test.js: wait for the first backoff step.", muted),
    ("", None),
    ("  $ npm test", dim),
    ("  ok 1 - retries a failed request", (120, 190, 130)),
    ("  ok 2 - gives up after five tries", (120, 190, 130)),
    ("  ok 3 - keeps the request id", (120, 190, 130)),
    ("  # pass 3, fail 0", dim),
    ("", None),
    ("The retry test passes now. One file changed.", foreground),
]
for n, (line, color) in enumerate(lines):
    if line:
        text(left + 24, top + 48 + n * 22, line, color, font=mono)
# The view's messages at the top of the card, its composer at the bottom, and an empty
# row of the view (with the card's own borders) stretched between them.
w, h = conversation.size
gap = (bottom * S - COMPOSER) - (top * S + h - COMPOSER)
img.paste(conversation.crop((0, 0, w, h - COMPOSER)), (panel_x * S, top * S))
img.paste(conversation.crop((0, h - COMPOSER - 2, w, h - COMPOSER - 1)).resize((w, gap)), (panel_x * S, top * S + h - COMPOSER))
img.paste(conversation.crop((0, h - COMPOSER, w, h)), (panel_x * S, bottom * S - COMPOSER))

# ── Status bar ──
hline(left, W, H - STATUS)
text(left + 12, H - STATUS + 7, "This computer  ·  main  ·  3 agents", muted, 11.5)
text(W - 104, H - STATUS + 7, "Cmd-P commands", dim, 11.5)

img.resize((W, H), Image.LANCZOS).save(ROOT / "preview.png", optimize=True)
print(f"preview.png {W}x{H}; chrome={chrome} background={background} border={border} accent={accent}")
