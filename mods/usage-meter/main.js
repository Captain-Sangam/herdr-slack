// Claude 5h, Claude 7d and Codex use, above Settings in the sidebar.
// Claude numbers come from the status line's cache; when that is over an hour old and
// the Mac is in use (or on a click), a one-word Haiku session refreshes it.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, home, readTextFile, theme, layout, notify } from "herdr";
import { parseClaude, parseCodex, cell, windowName, idleSeconds, probeDue, span, MINUTE, STALE, PROBE_EVERY } from "./lib.js";

const PROBE = "herdr-usage-probe";
const PROBE_ARGV = ["claude", "--model", "claude-haiku-5-5", "--strict-mcp-config", "--disable-slash-commands", "--tools", "", "--system-prompt", "Reply with ok.", "ok"];
// The newest three Codex rollouts of the last 8 days, only their last lines.
const CODEX = `find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -mtime -8 -exec ls -t {} + 2>/dev/null | head -3 | while IFS= read -r f; do tail -n 400 "$f" | grep '"token_count"' | tail -n 20; done`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The sidebar's rail goes by its width, as in workspace-chrome.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class UsageMeter extends View {
  init(_props, cx) {
    this.claude = null;
    this.codex = null;
    this.probing = false;
    this.refresh(cx, false);
    cx.timer.every(60000, (cx) => this.refresh(cx, false));
  }

  cachePath() {
    return `${home()}/.cache/herdr-slack/claude-usage.json`;
  }

  refresh(cx, manual) {
    cx.spawn(async (cx) => {
      // A torn or missing read keeps the last good value.
      this.claude = parseClaude(await readTextFile(this.cachePath()).catch(() => null)) ?? this.claude;
      const codex = await exec("sh", ["-c", CODEX]).catch(() => null);
      this.codex = parseCodex(codex?.stdout) ?? this.codex;
      cx.notify();
      await this.maybeProbe(cx, manual);
    });
  }

  async maybeProbe(cx, manual) {
    if (this.probing) return;
    const now = Date.now(), at = this.claude?.at ?? null, last = Number(localStorage.getItem("lastProbe")) || 0;
    let idle = null;
    if (!manual && last + PROBE_EVERY <= now && (at == null || now - at > STALE)) {
      const r = await exec("ioreg", ["-c", "IOHIDSystem", "-r", "-k", "HIDIdleTime", "-d", "1"]).catch(() => null);
      idle = idleSeconds(r?.stdout);
    }
    const due = probeDue({ at, idle, last, now, manual });
    if (manual && !due.probe) {
      notify({ title: "Claude usage", body: `A new check is allowed in ${span(due.wait / 1000)} (one every 30 min).`, level: "info", timeout: 4000 });
      return;
    }
    if (due.probe) await this.probe(cx, manual);
  }

  // Decision 12: a hidden one-word Haiku session; its status line refreshes the cache.
  async probe(cx, manual) {
    this.probing = true;
    localStorage.setItem("lastProbe", String(Date.now()));
    cx.notify();
    let started = false;
    try {
      if (!(await this.sweep())) return;
      const r = await hc(["run", "--bg", "--no-notify", "--no-parent", "--name", PROBE, "--cwd", `${home()}/code`, "--", ...PROBE_ARGV]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `hc run exited ${r.code}`);
      started = true;
      await exec("hc", ["wait", PROBE, "--timeout", "120"], { timeout: 130000 }).catch(() => null);
      this.claude = parseClaude(await readTextFile(this.cachePath()).catch(() => null)) ?? this.claude;
    } catch (e) {
      console.log(`usage-meter: probe failed: ${e?.message ?? e}`);
      if (manual) notify({ title: "Claude usage check failed", body: String(e?.message ?? e), level: "error" });
    } finally {
      if (started) await this.remove();
      this.probing = false;
      cx.notify();
    }
  }

  // A probe older than 5 min is a missed cleanup: kill and remove it. A younger live one
  // is still running, so no second probe starts.
  async sweep() {
    const r = await hc(["get", PROBE, "--json"]).catch(() => null);
    if (r?.code !== 0) return true;
    let t = null;
    try { t = JSON.parse(r.stdout); } catch {}
    if (t?.state === "live" && Date.now() - (t.created_ms ?? 0) < 5 * MINUTE) return false;
    await this.remove();
    return true;
  }

  async remove() {
    await hc(["kill", PROBE]).catch(() => null);
    await hc(["rm", PROBE]).catch(() => null);
  }

  async close() {
    if (this.probing) {
      await exec("hc", ["kill", PROBE]).catch(() => null);
      await exec("hc", ["rm", PROBE]).catch(() => null);
    }
  }

  rows(now) {
    const c = this.claude, x = this.codex;
    const rows = [
      { id: "c5", label: "Claude 5h", ...cell(c?.five, c?.at, now), w: c?.five },
      { id: "c7", label: "Claude 7d", ...cell(c?.week, c?.at, now), w: c?.week },
      { id: "x1", label: `Codex ${x?.primary ? windowName(x.primary.minutes) : "7d"}`, ...cell(x?.primary, x?.at, now), w: x?.primary },
    ];
    if (x?.secondary) rows.push({ id: "x2", label: `Codex ${windowName(x.secondary.minutes)}`, ...cell(x.secondary, x.at, now), w: x.secondary });
    return rows;
  }

  render(cx) {
    const t = theme(), now = Date.now(), rows = this.rows(now), rail = narrow();
    // A measured value, not unknown and not past its reset.
    const known = (r) => Boolean(r.pct) && r.pct !== "–";
    const level = (r) => (!known(r) ? t.dim : r.w.pct >= 95 ? t.ansi1 : r.w.pct >= 80 ? t.blocked : t.foreground);
    // Stale rows are dimmed; their age is in the tooltip.
    const color = (r) => (r.stale ? t.dim : level(r));
    const tip = (r) => `${r.label}: ${r.pct || "–"} ${r.reset === "reset" ? "(reset, waiting for new data)" : `resets in ${r.reset}`}${r.age ? `, data ${r.age} old` : ""}`;
    const spinner = () => svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.dim).spin(900);
    const root = v_flex().id("usage").size_full().justify_center().bg(t.chrome).border_t(1).border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.refresh(cx, true));
    if (rail) {
      return root.items_center().gap(4).text_size(10.5).children(rows.map((r) =>
        div().id(`rail-${r.id}`).whitespace_nowrap().tooltip(tip(r)).text_color(color(r)).child(r.reset === "reset" ? "↻" : r.pct)));
    }
    // Fixed columns: label and bar (flexible), percent, reset time. Nothing wraps.
    return root.px(16).gap(rows.length > 3 ? 2 : 6).text_size(12).children(rows.map((r) =>
      h_flex().id(`row-${r.id}`).h(22).gap(8).items_center().tooltip(tip(r))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().min_w(0).gap(5).items_center()
            .child(div().min_w(0).truncate().text_color(r.stale ? t.dim : t.muted).child(r.label))
            .when(this.probing && r.id.startsWith("c"), (el) => el.child(spinner())))
          .child(div().w_full().h(3).rounded(2).bg(t.border)
            .when(known(r), (el) => el.child(div().h_full().rounded(2).bg(color(r)).w(`${Math.min(100, Math.max(0, r.w.pct))}%`)))))
        .child(div().w(36).flex_none().whitespace_nowrap().text_right().text_color(color(r)).child(r.pct))
        .child(div().w(50).flex_none().whitespace_nowrap().text_right().text_color(t.dim).child(r.reset))));
  }
}
