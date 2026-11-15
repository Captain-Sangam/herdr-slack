import test from "node:test";
import assert from "node:assert/strict";
import { parseClaude, parseCodex, cell, span, windowName, idleSeconds, probeDue, HOUR, MINUTE } from "../mods/usage-meter/lib.js";

const NOW = 1_800_000_000_000; // ms

test("Claude cache parses, and a torn read is null", () => {
  const good = JSON.stringify({ at: 1_800_000_000, rate_limits: { five_hour: { used_percentage: 12.5, resets_at: 1_800_003_600 }, seven_day: { used_percentage: 40, resets_at: 1_800_400_000 } } });
  const c = parseClaude(good);
  assert.equal(c.at, NOW);
  assert.deepEqual(c.five, { pct: 12.5, reset: 1_800_003_600, minutes: 300 });
  assert.equal(c.week.pct, 40);
  assert.equal(parseClaude(good.slice(0, 40)), null);
  assert.equal(parseClaude(""), null);
  assert.equal(parseClaude(JSON.stringify({ at: 1, rate_limits: null })), null);
});

test("Codex: the newest token_count with rate_limits wins", () => {
  const ev = (timestamp, rl) => JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", rate_limits: rl } });
  const text = [
    ev("2026-11-15T11:00:00Z", { primary: { used_percent: 20, window_minutes: 10080, resets_at: 1_800_100_000 }, secondary: null }),
    ev("2026-11-15T12:00:00Z", null),
    "{ torn",
    ev("2026-11-15T11:30:00Z", { primary: { used_percent: 27, window_minutes: 10080, resets_at: 1_800_100_000 }, secondary: { used_percent: 3, window_minutes: 300, resets_at: 1_800_001_000 } }),
    ev("2026-11-15T10:00:00Z", { primary: { used_percent: 10, window_minutes: 10080, resets_at: 1 }, secondary: null }),
  ].join("\n");
  const c = parseCodex(text);
  assert.equal(c.primary.pct, 27);
  assert.equal(c.secondary.pct, 3);
  assert.equal(windowName(c.primary.minutes), "7d");
  assert.equal(windowName(c.secondary.minutes), "5h");
  assert.equal(parseCodex(""), null);
});

test("display: unknown, expired reset, stale age", () => {
  assert.deepEqual(cell(null, null, NOW), { pct: "–", reset: "–", stale: true, age: null });
  const w = { pct: 42.4, reset: NOW / 1000 + 4.5 * 3600 };
  assert.deepEqual(cell(w, NOW - MINUTE, NOW), { pct: "42%", reset: "4h30m", stale: false, age: null });
  // An expired resets_at shows "reset" and no number.
  assert.deepEqual(cell({ pct: 90, reset: NOW / 1000 - 5 }, NOW - MINUTE, NOW), { pct: "", reset: "reset", stale: false, age: null });
  const old = cell(w, NOW - 2 * HOUR - 5 * MINUTE, NOW);
  assert.equal(old.stale, true);
  assert.equal(old.age, "2h5m");
  assert.equal(span(5 * 86400 + 7 * 3600 + 100), "5d7h");
  assert.equal(span(30), "1m");
});

test("idle time from ioreg", () => {
  assert.equal(idleSeconds('    |   "HIDIdleTime" = 49221083000\n'), 49.221083);
  assert.equal(idleSeconds("nothing"), null);
});

test("probe: stale and in use, one per 30 min, clicks get the wait", () => {
  const fresh = NOW - 10 * MINUTE, old = NOW - 2 * HOUR;
  assert.equal(probeDue({ at: old, idle: 30, last: 0, now: NOW }).probe, true);
  assert.equal(probeDue({ at: null, idle: 30, last: 0, now: NOW }).probe, true);
  assert.equal(probeDue({ at: fresh, idle: 30, last: 0, now: NOW }).probe, false);
  assert.equal(probeDue({ at: old, idle: 3600, last: 0, now: NOW }).probe, false);
  assert.equal(probeDue({ at: old, idle: null, last: 0, now: NOW }).probe, false);
  const cooling = probeDue({ at: old, idle: 30, last: NOW - 10 * MINUTE, now: NOW, manual: true });
  assert.deepEqual(cooling, { probe: false, wait: 20 * MINUTE });
  assert.equal(probeDue({ at: fresh, idle: 9999, last: NOW - 31 * MINUTE, now: NOW, manual: true }).probe, true);
});
