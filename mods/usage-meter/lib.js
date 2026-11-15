// Pure helpers for the usage meter. Nothing here imports herdr or gpui-kit, so
// `node --test` runs them and the mod imports the same file.

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const STALE = HOUR;            // decision 14: dim and show age after this
export const PROBE_EVERY = 30 * MINUTE; // decision 12: one probe per 30 min
export const IDLE_MAX = 600;          // seconds: "the Mac was used in the last 10 min"

const win = (pct, reset, minutes = null) =>
  pct == null || !Number.isFinite(Number(pct)) ? null : { pct: Number(pct), reset: Number(reset) || null, minutes };

// statusline.sh writes {"at": <unix s>, "rate_limits": {five_hour, seven_day}}.
// A torn or partial read returns null; the caller keeps its last good value.
export function parseClaude(text) {
  try {
    const j = JSON.parse(text);
    const rl = j?.rate_limits;
    if (!rl?.five_hour || !Number.isFinite(j.at)) return null;
    return {
      at: j.at * 1000,
      five: win(rl.five_hour.used_percentage, rl.five_hour.resets_at, 300),
      week: win(rl.seven_day?.used_percentage, rl.seven_day?.resets_at, 10080),
    };
  } catch {
    return null;
  }
}

// Codex rollout lines; the newest token_count event that has rate_limits wins.
export function parseCodex(text) {
  let best = null;
  for (const line of String(text ?? "").split("\n")) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const rl = j?.payload?.type === "token_count" ? j.payload.rate_limits : null;
    if (!rl?.primary) continue;
    const at = Date.parse(j.timestamp) || 0;
    if (best && at <= best.at) continue;
    best = {
      at,
      primary: win(rl.primary.used_percent, rl.primary.resets_at, rl.primary.window_minutes ?? null),
      secondary: rl.secondary ? win(rl.secondary.used_percent, rl.secondary.resets_at, rl.secondary.window_minutes ?? null) : null,
    };
  }
  return best;
}

// "5h" for 300 minutes, "7d" for 10080.
export const windowName = (minutes) =>
  !minutes ? "?" : minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;

// Seconds as the status line writes them: 12m, 4h30m, 5d7h.
export function span(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
}

// Decision 14. Unknown is "–", never 0%. A passed reset shows "reset" and no number.
// Data older than an hour is stale and carries its age.
export function cell(w, at, now) {
  const stale = at == null || now - at > STALE;
  const age = at == null ? null : stale ? span((now - at) / 1000) : null;
  if (!w) return { pct: "–", reset: "–", stale, age };
  if (w.reset && w.reset * 1000 <= now) return { pct: "", reset: "reset", stale, age };
  return { pct: `${Math.round(w.pct)}%`, reset: w.reset ? span(w.reset - now / 1000) : "–", stale, age };
}

// HIDIdleTime is nanoseconds since the last keyboard or mouse input.
export function idleSeconds(ioreg) {
  const m = /"HIDIdleTime" = (\d+)/.exec(ioreg ?? "");
  return m ? Number(m[1]) / 1e9 : null;
}

// Decision 12. Both triggers share the 30-minute limit; a manual click inside it
// gets the wait. Automatic: the cache is over an hour old and the Mac is in use.
export function probeDue({ at, idle, last, now, manual = false }) {
  const wait = last ? last + PROBE_EVERY - now : 0;
  if (wait > 0) return { probe: false, wait };
  if (manual) return { probe: true, wait: 0 };
  return { probe: (at == null || now - at > STALE) && idle != null && idle < IDLE_MAX, wait: 0 };
}
