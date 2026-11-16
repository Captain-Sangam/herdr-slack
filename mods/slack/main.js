// Slack DMs, group DMs and @-mentions. Two copies in main-slack:
// - role "button" (tab bar, always shown): reads the token, polls Slack every minute,
//   publishes shared "slack.items" and "slack.status", draws the button and badge.
// - role "panel" (in panel-body): renders the list and acts on it, and opens a
//   conversation view with a reply composer. The view's messages and the drafts stay
//   in this copy's memory, never in shared. Only an explicit Send posts (ADR 0011).

import { View, div, svg, image } from "gpui-kit";
import {
  h_flex,
  v_flex,
  InputState,
  Input,
  Scrollbar,
  ScrollHandle,
  TextView,
  TextareaState,
  Textarea,
} from "gpui-base";
import {
  exec,
  theme,
  layout,
  run,
  props,
  shared,
  setShared,
  spaces,
  home,
  appHome,
  notify,
  knownAgents,
} from "herdr";
import {
  toItem,
  merge,
  markRead,
  markKey,
  staleMarks,
  unmarked,
  pruneSeen,
  unreadCount,
  userIds,
  channelRefs,
  backoff,
  visible,
  patterns,
  unread,
  ago,
  sendToAgent,
  cacheWork,
  withCache,
  fit,
  CACHE,
  KINDS,
  groupRows,
  viewOf,
  threadView,
  toMessage,
  collapse,
  mergeMessages,
  around,
  permalink,
  clock,
  stackOf,
  customParts,
  hostOf,
  linkable,
  AUTH,
  replyTarget,
  replyBody,
  postReply,
  replyError,
  AGENT,
  MODELS,
  modelFlag,
  validModel,
  contextText,
} from "./lib.js";

const API = "https://slack.com/api/";
// Message files need the token: it goes from the Keychain to curl on stdin, never in argv.
const FILE_GET = `security find-generic-password -s herdr-slack -w | sed 's/.*/header = "Authorization: Bearer &"/' | curl -sfL --max-time 20 -K - -o "$1" -w '%{content_type}' "$2"`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const items = () => shared("slack.items") ?? [];
const seenSet = () => new Set(shared("slack.seen") ?? []);
const dismissedSet = () => new Set(shared("slack.dismissed") ?? []);
const filters = () => shared("slack.filters") ?? {};

class SlackError extends Error {
  constructor(kind, detail) {
    super(detail ?? kind);
    this.kind = kind;
    this.detail = detail;
  }
}

export default class Slack extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "panel";
    if (this.role === "button") this.initPoller(cx);
    else this.initPanel(cx);
  }

  // ── Poller (button copy) ───────────────────────────────────────────────────

  initPoller(cx) {
    this.token = null; // instance memory only
    this.me = null; // the token's user id, from auth.test (shared as "slack.me")
    this.polling = false;
    this.delay = 0; // backoff, ms
    this.until = 0;
    // Kept across reloads, so unread counts are right before fresh values arrive.
    this.lastRead = JSON.parse(localStorage.getItem("lastRead") ?? "{}"); // markKey -> last_read ts
    this.checked = {}; // markKey -> time of the last fetch, ms
    this.channels = JSON.parse(localStorage.getItem("channels") ?? "{}"); // channel id -> name (null: not visible)
    this.members = JSON.parse(localStorage.getItem("members") ?? "{}"); // group DM id -> member ids
    this.people = JSON.parse(localStorage.getItem("people") ?? "{}"); // id -> {name, image}
    localStorage.removeItem("users"); // the older names-only cache
    this.failed = {}; // cache file name -> time of a failed download
    const root = `${appHome()}/${CACHE}`;
    exec("mkdir", ["-p", ...KINDS.map((k) => `${root}/${k}`)]).catch(
      () => null,
    );
    this.published = JSON.stringify(items());
    // Decision 3: tabs restores a space's panel only if its id is listed here.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes("slack"))
      setShared("workspace.panels", [...panels, "slack"]);
    this.poll(cx);
    cx.timer.every(60000, (cx) => this.poll(cx));
  }

  async call(method, params) {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    let res;
    try {
      res = await fetch(`${API}${method}?${query}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
    } catch (e) {
      throw new SlackError("network", String(e?.message ?? e));
    }
    if (res.status === 429) throw new SlackError("ratelimited");
    let body;
    try {
      body = await res.json();
    } catch {
      throw new SlackError("network", `HTTP ${res.status}`);
    }
    if (!body?.ok)
      throw new SlackError(
        body?.error === "ratelimited"
          ? "ratelimited"
          : AUTH.has(body?.error)
            ? "auth"
            : "api",
        body?.error ?? `HTTP ${res.status}`,
      );
    return body;
  }

  async search(query) {
    const r = await this.call("search.messages", {
      query,
      sort: "timestamp",
      sort_dir: "desc",
      count: 50,
    });
    return r.messages?.matches ?? [];
  }

  // An "api" error on one lookup (a channel or user we cannot see) skips it; others stop the poll.
  async optional(method, params) {
    try {
      return await this.call(method, params);
    } catch (e) {
      if (e.kind === "api") return null;
      throw e;
    }
  }

  // Both copies read the token the same way: Keychain, then instance memory only.
  async ensureToken() {
    if (this.token) return;
    const r = await exec("security", [
      "find-generic-password",
      "-s",
      "herdr-slack",
      "-w",
    ]).catch(() => null);
    if (r?.code !== 0 || !r.stdout.trim()) throw new SlackError("no-token");
    this.token = r.stdout.trim();
  }

  // Names and public avatar URLs, at most `max` new people per call.
  async resolvePeople(ids, max = 10) {
    // Entries cached before real names and handles were kept are looked up again.
    const missing = ids
      .filter((id) => !(this.people[id] && "handle" in this.people[id]))
      .slice(0, max);
    for (const id of missing) {
      const r = await this.optional("users.info", { user: id });
      const u = r?.user,
        p = u?.profile;
      this.people[id] = {
        name: p?.display_name || u?.real_name || u?.name || id,
        real: u?.real_name || p?.real_name || null,
        handle: u?.name || null,
        image: p?.image_72 || p?.image_48 || null,
      };
    }
    if (missing.length)
      localStorage.setItem("people", JSON.stringify(this.people));
  }

  // The image cache: drop files no item references, fetch at most 10 missing ones per
  // poll, never one already on disk, and retry a failed one after 10 min at the soonest.
  async syncImages(list) {
    const root = `${appHome()}/${CACHE}`;
    const ls = async (kind) =>
      new Set(
        (
          (await exec("ls", ["-1", `${root}/${kind}`]).catch(() => null))
            ?.stdout ?? ""
        )
          .split("\n")
          .filter(Boolean),
      );
    const have = {
      avatars: await ls("avatars"),
      files: await ls("files"),
      media: await ls("media"),
    };
    const { stale, missing } = cacheWork(list, have);
    for (const kind of KINDS) {
      if (!stale[kind].length) continue;
      await exec("rm", [
        "-f",
        ...stale[kind].map((n) => `${root}/${kind}/${n}`),
      ]).catch(() => null);
      for (const n of stale[kind]) have[kind].delete(n);
    }
    const now = Date.now();
    for (const job of missing
      .filter((j) => !(now - (this.failed[j.name] ?? 0) < 600000))
      .slice(0, 10)) {
      if (await this.download(root, job)) {
        have[job.kind].add(job.name);
        delete this.failed[job.name];
      } else this.failed[job.name] = now;
    }
    return withCache(list, have);
  }

  // Into a hidden .part file, kept only if an image came back (a missing scope sends HTML).
  // Only Slack files get the token; avatars and media (GIPHY) are public and never do.
  async download(root, { kind, name, url }) {
    const part = `${root}/${kind}/.${name}.part`,
      dest = `${root}/${kind}/${name}`;
    const r =
      kind === "files"
        ? await exec("sh", ["-c", FILE_GET, "sh", part, url], {
            timeout: 25000,
          }).catch(() => null)
        : await exec(
            "curl",
            [
              "-sfL",
              "--max-time",
              "20",
              "--max-filesize",
              "8000000",
              "-o",
              part,
              "-w",
              "%{content_type}",
              url,
            ],
            { timeout: 25000 },
          ).catch(() => null);
    const ok = r?.code === 0 && r.stdout.trim().startsWith("image/");
    await exec(ok ? "mv" : "rm", ok ? ["-f", part, dest] : ["-f", part]).catch(
      () => null,
    );
    return ok;
  }

  // ADR 0013: read marks, least recently checked first. A conversation's last_read comes
  // from conversations.info, which also names the channel for mentions written as <#C123>.
  // A thread's comes from its parent in conversations.replies, set while you follow the thread.
  async refreshMarks(keys, list) {
    for (const k of keys) {
      const [ch, thread] = k.split(":");
      this.checked[k] = Date.now();
      if (thread) {
        const r = await this.optional("conversations.replies", {
          channel: ch,
          ts: thread,
          limit: 1,
        });
        const mark = r?.messages?.find((m) => m.ts === thread)?.last_read;
        if (mark != null) this.lastRead[k] = mark;
        continue;
      }
      const r = await this.optional("conversations.info", { channel: ch });
      if (!r?.channel) continue;
      if (r.channel.last_read != null) this.lastRead[k] = r.channel.last_read;
      if (r.channel.name && !r.channel.is_im)
        this.channels[ch] = r.channel.name;
    }
    const keep = new Set(list.map(markKey));
    for (const map of [this.lastRead, this.checked])
      for (const k of Object.keys(map)) if (!keep.has(k)) delete map[k];
    localStorage.setItem("lastRead", JSON.stringify(this.lastRead));
  }

  // Group DM members (conversations.members, mpim:read): a group DM's members never change,
  // so each is looked up once; at most 10 per poll.
  async resolveMembers(chs) {
    const missing = chs.filter((ch) => !(ch in this.members)).slice(0, 10);
    for (const ch of missing)
      this.members[ch] =
        (
          await this.optional("conversations.members", {
            channel: ch,
            limit: 50,
          })
        )?.members ?? [];
    if (missing.length)
      localStorage.setItem("members", JSON.stringify(this.members));
  }

  // Names for channels mentioned as <#C123>: at most 10 lookups per poll; one we
  // cannot see is remembered as null and shows its id.
  async resolveChannels(ids) {
    const missing = ids.filter((id) => !(id in this.channels)).slice(0, 10);
    for (const id of missing)
      this.channels[id] =
        (await this.optional("conversations.info", { channel: id }))?.channel
          ?.name ?? null;
    if (missing.length)
      localStorage.setItem("channels", JSON.stringify(this.channels));
  }

  setStatus(state, message = "") {
    const now = shared("slack.status");
    if (now?.state !== state || now?.message !== message)
      setShared("slack.status", { state, message });
  }

  poll(cx) {
    if (this.polling || Date.now() < this.until) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.token) {
          const r = await exec("security", [
            "find-generic-password",
            "-s",
            "herdr-slack",
            "-w",
          ]).catch(() => null);
          if (r?.code !== 0 || !r.stdout.trim()) {
            this.setStatus(
              "no-token",
              "No Slack token in the Keychain. See README: Slack app setup.",
            );
            return;
          }
          this.token = r.stdout.trim();
          this.me = null; // whose token this is: asked again below
        }
        // The token's own user id, from auth.test. No search runs before it is known.
        if (!this.me) {
          this.me = (await this.call("auth.test", {})).user_id ?? null;
          if (!this.me)
            throw new SlackError("api", "auth.test returned no user_id");
          if (shared("slack.me") !== this.me) setShared("slack.me", this.me);
        }
        const me = this.me;
        const mentions = await this.search(`<@${me}>`),
          direct = await this.search("to:me");
        const groups = [
          ...new Set(
            [...mentions, ...direct]
              .filter((m) => m.channel?.is_mpim)
              .map((m) => m.channel.id),
          ),
        ];
        await this.resolveMembers(groups);
        await this.resolvePeople([
          ...userIds([...mentions, ...direct]),
          ...groups.flatMap((ch) => this.members[ch] ?? []),
        ]);
        await this.resolveChannels(channelRefs([...mentions, ...direct]));
        const names = {},
          images = {},
          aliases = {};
        for (const [id, p] of Object.entries(this.people)) {
          names[id] = p.name;
          if (p.image) images[id] = p.image;
          aliases[id] = [p.real, p.handle].filter(Boolean);
        }
        for (const [id, name] of Object.entries(this.channels))
          if (name) names[id] = name;
        const fresh = [
          ...mentions.map((m) =>
            toItem(m, {
              mention: true,
              names,
              images,
              members: this.members,
              aliases,
              me,
            }),
          ),
          ...direct.map((m) =>
            toItem(m, { names, images, members: this.members, aliases, me }),
          ),
        ];
        const before = markRead(
            merge(items(), fresh, filters()),
            this.lastRead,
          ),
          dismissed = dismissedSet();
        await this.refreshMarks(
          staleMarks(
            before.filter((i) => !dismissed.has(i.id)),
            seenSet(),
            this.checked,
          ),
          before,
        );
        let list = markRead(before, this.lastRead);
        const back = new Set(unmarked(before, list));
        list = await this.syncImages(list);
        // Decision 4: publish only when the list changed; setShared re-renders every mod.
        const json = JSON.stringify(list);
        if (json !== this.published) {
          this.published = json;
          setShared("slack.items", list);
        }
        // Read again here: the panel may have added ids during the lookups.
        const seen = shared("slack.seen") ?? [],
          pruned = pruneSeen(seen, list).filter((id) => !back.has(id));
        if (pruned.length !== seen.length) setShared("slack.seen", pruned);
        const hidden = shared("slack.dismissed") ?? [],
          kept = pruneSeen(hidden, list);
        if (kept.length !== hidden.length) setShared("slack.dismissed", kept);
        this.delay = 0;
        this.setStatus("ok");
      } catch (e) {
        // Fails toward stale data: the last items stay, the status says why.
        if (e.kind === "ratelimited") {
          this.delay = backoff(this.delay);
          this.until = Date.now() + this.delay;
          this.setStatus(
            "ratelimited",
            `Slack rate limit. Next try in ${Math.round(this.delay / 60000)} min.`,
          );
        } else if (e.kind === "auth") {
          this.token = null; // read the Keychain again next poll
          this.me = null;
          this.setStatus(
            "auth",
            `Slack refused the token (${e.detail}). See README: Slack app setup.`,
          );
        } else if (e.kind === "network") {
          this.setStatus(
            "network",
            "Cannot reach Slack. Retrying every minute.",
          );
        } else {
          this.setStatus("error", `Slack error: ${e.detail ?? e.message ?? e}`);
        }
      } finally {
        this.polling = false;
        cx.notify();
      }
    });
  }

  // ── Button (tab bar) ───────────────────────────────────────────────────────

  renderButton(t) {
    const root = layout(),
      panel = find(root, "panel"),
      body = find(root, "panel-body");
    const on = Boolean(panel && !panel.hidden && body?.active === "slack");
    const count = unreadCount(items(), seenSet(), filters(), dismissedSet());
    const status = shared("slack.status");
    const problem = status && status.state !== "ok" ? status : null;
    const stop = (_e, cx) => cx.stop_propagation();
    // Same look as the tabs mod's Files and Changes buttons.
    return h_flex()
      .size_full()
      .pr(10)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("panel-slack")
          .h(26)
          .px(8)
          .gap(5)
          .flex_none()
          .items_center()
          .rounded(6)
          .text_size(12)
          .bg(on ? t.selected : t.chrome)
          .text_color(on ? t.foreground : t.muted)
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop)
          .tooltip(
            problem ? problem.message : count ? `${count} unread` : "Slack",
          )
          .on_click(() => {
            if (on) run("layout.hide", { id: "panel" });
            else {
              run("layout.select", { stack: "panel-body", child: "slack" });
              run("layout.show", { id: "panel" });
            }
          })
          .child(svg("mods/slack/slack.svg").size(14))
          .child("Slack")
          .when(count > 0, (el) =>
            el.child(
              div()
                .h(16)
                .min_w(16)
                .px(4)
                .flex()
                .items_center()
                .justify_center()
                .rounded(8)
                .bg(t.accent)
                .text_color(t.accent_foreground)
                .text_size(10)
                .child(count > 99 ? "99+" : String(count)),
            ),
          )
          .when(Boolean(problem) && !count, (el) =>
            el.child(
              div()
                .size(6)
                .rounded(3)
                .bg(
                  problem.state === "no-token" || problem.state === "auth"
                    ? t.blocked
                    : t.dim,
                ),
            ),
          ),
      );
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  initPanel(cx) {
    this.tab = "all";
    this.sending = null;
    this.showFilters = false;
    this.unreadOnly = localStorage.getItem("unreadOnly") === "1";
    this.hovered = null;
    // The conversation view: a stack of views (a thread opened from a view goes on top).
    this.views = [];
    this.viewRow = null;
    this.handle = cx.focus_handle();
    this.listScroll = ScrollHandle.new();
    this.viewScroll = ScrollHandle.new();
    this.token = null;
    this.failed = {};
    this.viewHave = { avatars: new Set(), files: new Set(), media: new Set() };
    this.listAvatars = new Set();
    this.channels = JSON.parse(localStorage.getItem("channels") ?? "{}");
    this.people = JSON.parse(localStorage.getItem("people") ?? "{}");
    for (const i of items())
      if (i.user && !(i.user in this.people))
        this.people[i.user] = { name: i.sender, image: i.face?.url ?? null };
    const f = filters();
    this.include = InputState.new({
      placeholder: "all channels (eng-*, team-?)",
      value: (f.include ?? []).join(", "),
    });
    this.exclude = InputState.new({
      placeholder: "none (alerts-*, Notetaker, *bot*)",
      value: (f.exclude ?? []).join(", "),
    });
    for (const input of [this.include, this.exclude]) {
      input.on("submit", () => this.saveFilters());
      input.on("blur", () => this.saveFilters());
    }
    // Send to agent settings (ADR 0012): the installed agents, and the model field.
    this.agents = [];
    cx.spawn(async (cx) => {
      this.agents = await knownAgents().catch(() => []);
      cx.notify();
    });
    this.model = InputState.new({
      placeholder: "the agent's own default",
      value: this.agentSettings().model,
    });
    this.model.on("submit", (_e, cx) => this.saveModel(cx));
    this.model.on("blur", (_e, cx) => this.saveModel(cx));
    this.modelError = null;
    // Reply composers by target: the drafts live here only, never in shared.
    this.replies = new Map();
    this.posting = null; // the target key of the one post in flight
    this.typing = false;
    // Enter sends and Shift+Enter adds a line, in the composer only. These bindings sit
    // at the input's own depth and come later, so they win over its Enter.
    cx.bind_keys([
      {
        keystroke: "enter",
        action: "slack-reply-send",
        context: "SlackReply > Input",
      },
      {
        keystroke: "shift-enter",
        action: "slack-reply-line",
        context: "SlackReply > Input",
      },
    ]);
    // Relative times ("5m") move on without new data; an open view refreshes.
    cx.timer.every(60000, (cx) => {
      if (this.views.length) this.loadView(cx);
      else cx.notify();
    });
  }

  // ── Conversation view (panel copy) ──────────────────────────────────────────

  openRow(r, cx) {
    this.markSeen(...r.items.map((i) => i.id));
    this.viewRow = r;
    this.views = [{ ...viewOf(r), raw: [], messages: [], cursor: null }];
    this.openView(cx);
  }

  openThread(ts, cx) {
    this.views.push({
      ...threadView(this.views.at(-1), ts),
      raw: [],
      messages: [],
      cursor: null,
    });
    this.openView(cx);
  }

  openView(cx) {
    this.stick = true; // at the bottom until the person scrolls up
    this.composer(this.views.at(-1)).state.focus();
    this.loadView(cx, { first: true });
    cx.notify();
  }

  // Back to the previous view, or to the list at its tab and scroll position. An empty
  // composer that no open view uses is released; a draft stays for the next visit.
  back(cx) {
    const v = this.views.pop(),
      key = replyTarget(v).key,
      r = this.replies.get(key);
    this.handle.focus();
    if (
      r &&
      !r.state.value().trim() &&
      this.posting !== key &&
      !this.views.some((w) => replyTarget(w).key === key)
    ) {
      this.replies.delete(key);
      r.state.release();
    }
    if (!this.views.length) this.viewRow = null;
    this.stick = false;
    cx.notify();
  }

  // The composer for a view, made on first use. Each target keeps its own text.
  composer(v) {
    const target = replyTarget(v, this.viewRow);
    let r = this.replies.get(target.key);
    if (r) return r;
    const state = TextareaState.new({ placeholder: target.placeholder });
    state.set_auto_grow(1, 6);
    r = { state, target, error: null, empty: true };
    state.on("change", (_e, cx) => {
      const empty = !state.value().trim();
      if (empty !== r.empty || r.error) {
        r.empty = empty;
        r.error = null;
        cx.notify();
      }
    });
    state.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    state.on("blur", (_e, cx) => {
      this.typing = false;
      cx.notify();
    });
    // Only if the Enter binding above does not reach this input: its own Enter has
    // typed a line break at the cursor, which the send takes out again.
    state.on("submit", (e, cx) => {
      if (e?.shift) return;
      const at = state.selected_range()?.start ?? 0,
        text = state.value();
      if (text[at - 1] === "\n")
        state.set_value(text.slice(0, at - 1) + text.slice(at));
      this.sendReply(r, cx);
    });
    this.replies.set(target.key, r);
    return r;
  }

  // Decision 11: one post at a time, only from Send or Enter, never retried. A failure
  // keeps the text and shows Slack's error; a success clears it and shows the message.
  sendReply(r, cx) {
    const body = replyBody(r.target, r.state.value());
    if (!body || this.posting) return;
    const v = this.views.at(-1);
    this.posting = r.target.key;
    r.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let res;
      try {
        await this.ensureToken();
        res = await postReply(body, { fetch, token: this.token });
      } catch (e) {
        res = { ok: false, error: e.kind ?? "network" };
      }
      this.posting = null;
      if (res.ok) {
        r.state.set_value("");
        r.empty = true;
        this.markSeen(...(this.viewRow?.items ?? []).map((i) => i.id));
        if (this.views.at(-1) === v) this.showPosted(v, res.message, cx);
      } else {
        r.error = replyError(res.error);
        if (AUTH.has(res.error) && res.error !== "missing_scope")
          this.token = null;
      }
      cx.notify();
    });
  }

  // The posted message shows at once, then the view loads again. A reply under a
  // mention outside a thread opens that thread, where the reply is.
  showPosted(v, message, cx) {
    if (v.mode === "around") {
      const anchor = v.raw.filter((m) => m.ts === v.anchor);
      this.openThread(v.anchor, cx);
      const t = this.views.at(-1);
      t.posted = [message];
      this.show(t, [...anchor, message]);
      return;
    }
    v.posted = [...(v.posted ?? []), message];
    this.show(v, mergeMessages(v.raw, [message]));
    this.stick = true;
    this.bottom(v);
    this.composer(v).state.focus();
    this.loadView(cx);
  }

  show(v, raw) {
    const { names, images } = this.names();
    v.raw = raw;
    v.messages = collapse(
      raw.map((m) =>
        toMessage(m, {
          names,
          images,
          me: shared("slack.me") ?? null,
          host: hostOf(this.viewRow?.latest?.link),
        }),
      ),
    );
  }

  bottom(v) {
    const lead = v.mode === "history" && v.cursor ? 1 : 0; // "Load older"
    if (v.messages.length)
      this.viewScroll.scroll_to_item(lead + v.messages.length - 1);
  }

  names() {
    const names = {},
      images = {};
    for (const [id, p] of Object.entries(this.people)) {
      names[id] = p.name;
      if (p.image) images[id] = p.image;
    }
    for (const [id, name] of Object.entries(this.channels))
      if (name) names[id] = name;
    return { names, images };
  }

  loadView(cx, { first = false, older = false } = {}) {
    const v = this.views.at(-1);
    if (!v || v.loading) return;
    v.loading = true;
    cx.spawn(async (cx) => {
      try {
        await this.ensureToken();
        let raw,
          added = 0;
        if (v.mode === "history") {
          const r = await this.call("conversations.history", {
            channel: v.ch,
            limit: 50,
            ...(older && v.cursor ? { cursor: v.cursor } : {}),
          });
          if (first || older)
            v.cursor = r.has_more
              ? r.response_metadata?.next_cursor || null
              : null;
          raw = mergeMessages(v.raw, r.messages ?? []);
          added = raw.length - v.raw.length;
        } else if (v.mode === "thread")
          raw = mergeMessages(
            v.posted ?? [],
            await this.thread(v.ch, v.thread),
          );
        else raw = await this.around(v.ch, v.anchor);
        await this.resolvePeople(userIds(raw), 30);
        await this.resolveChannels(channelRefs(raw));
        const grew = raw.length !== v.raw.length;
        this.show(v, raw);
        v.error = null;
        await this.viewImages();
        // Child 0 is "Load older" when there is more history.
        const lead = v.mode === "history" && v.cursor ? 1 : 0;
        if (older)
          this.viewScroll.scroll_to_item(
            Math.min(added + lead, v.messages.length + lead - 1),
          );
        else if (first && v.mode !== "history")
          this.viewScroll.scroll_to_item(
            lead +
              Math.max(
                0,
                v.messages.findIndex((m) => m.ts === v.anchor),
              ),
          );
        else if (first || (grew && this.stick)) this.bottom(v);
      } catch (e) {
        v.error =
          e.detail === "missing_scope"
            ? "Needs history permission: update the Slack app, see README."
            : e.kind === "no-token"
              ? "No Slack token in the Keychain. See README: Slack app setup."
              : e.kind === "auth"
                ? `Slack refused the token (${e.detail}).`
                : e.kind === "network"
                  ? "Cannot reach Slack."
                  : e.kind === "ratelimited"
                    ? "Slack rate limit. Try again in a minute."
                    : `Slack error: ${e.detail ?? e.message ?? e}`;
        if (e.kind === "auth" && e.detail !== "missing_scope")
          this.token = null;
      } finally {
        v.loading = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  // A thread, up to 5 pages of 200 (conversations.replies).
  async thread(ch, ts) {
    let all = [],
      cursor = null;
    for (let page = 0; page < 5; page++) {
      const r = await this.call("conversations.replies", {
        channel: ch,
        ts,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      all = all.concat(r.messages ?? []);
      cursor = r.has_more ? r.response_metadata?.next_cursor || null : null;
      if (!cursor) break;
    }
    return mergeMessages([], all);
  }

  // A message in context: the 15 messages up to it and the 10 after it.
  async around(ch, ts) {
    const before = await this.call("conversations.history", {
      channel: ch,
      latest: ts,
      inclusive: true,
      limit: 15,
    });
    const after = await this.call("conversations.history", {
      channel: ch,
      oldest: ts,
      limit: 100,
    });
    return around(before.messages ?? [], after.messages ?? []);
  }

  // The conversation as text for an agent without Slack tools, fetched as the view
  // does: the thread, else the messages around the item. Never the token.
  async context(item) {
    try {
      await this.ensureToken();
      const raw = item.thread
        ? await this.thread(item.ch, item.thread)
        : await this.around(item.ch, item.ts);
      await this.resolvePeople(userIds(raw), 30);
      return contextText(raw, {
        names: this.names().names,
        base: item.link,
        ch: item.ch,
        thread: item.thread,
      });
    } catch (e) {
      return `(The conversation could not be loaded: ${e.detail ?? e.kind ?? e}. Only the preview above is known.)`;
    }
  }

  // The view's pictures. Avatars the list already cached are used from there; the rest,
  // and message images, go under .slack-cache/view/, which holds only what the open
  // views reference (same download and retry rules as the list's cache).
  async viewImages() {
    const root = `${appHome()}/${CACHE}`,
      viewRoot = `${root}/view`;
    await exec("mkdir", ["-p", ...KINDS.map((k) => `${viewRoot}/${k}`)]).catch(
      () => null,
    );
    const ls = async (dir) =>
      new Set(
        ((await exec("ls", ["-1", dir]).catch(() => null))?.stdout ?? "")
          .split("\n")
          .filter(Boolean),
      );
    this.listAvatars = await ls(`${root}/avatars`);
    const have = {
      avatars: await ls(`${viewRoot}/avatars`),
      files: await ls(`${viewRoot}/files`),
      media: await ls(`${viewRoot}/media`),
    };
    const refs = this.views
      .flatMap((v) => v.messages)
      .flatMap((m) => [
        ...(m.face && !this.listAvatars.has(m.face.name)
          ? [{ face: m.face }]
          : []),
        ...m.images.map((f) => ({ file: f })),
        ...m.media.map((f) => ({ media: f })),
      ]);
    const { stale, missing } = cacheWork(refs, have);
    for (const kind of KINDS) {
      if (!stale[kind].length) continue;
      await exec("rm", [
        "-f",
        ...stale[kind].map((n) => `${viewRoot}/${kind}/${n}`),
      ]).catch(() => null);
      for (const n of stale[kind]) have[kind].delete(n);
    }
    const now = Date.now();
    for (const job of missing
      .filter((j) => !(now - (this.failed[j.name] ?? 0) < 600000))
      .slice(0, 20)) {
      if (await this.download(viewRoot, job)) {
        have[job.kind].add(job.name);
        delete this.failed[job.name];
      } else this.failed[job.name] = now;
    }
    this.viewHave = have;
  }

  saveFilters() {
    const next = {
      include: patterns(this.include.value()),
      exclude: patterns(this.exclude.value()),
    };
    if (
      JSON.stringify(next) !==
      JSON.stringify({
        include: filters().include ?? [],
        exclude: filters().exclude ?? [],
      })
    )
      setShared("slack.filters", next);
  }

  agentSettings() {
    return { ...AGENT, ...(shared("slack.agent") ?? {}) };
  }

  // A new agent starts with its default model: Claude's, else the agent's own.
  pickAgent(key, cx) {
    const model = key === AGENT.agent ? AGENT.model : "";
    this.model.set_value(model);
    this.modelError = null;
    setShared("slack.agent", { agent: key, model });
    cx.notify();
  }

  // An invalid model is not saved; the field says why.
  saveModel(cx) {
    const now = this.agentSettings(),
      model = this.model.value().trim();
    this.modelError = validModel(model)
      ? null
      : 'Letters, digits, ".", "-", "_" and "/" only. Not saved.';
    if (!this.modelError && model !== now.model)
      setShared("slack.agent", { agent: now.agent, model });
    cx.notify();
  }

  // Hides a row's items here and in the badge, and marks them seen. Slack is not changed.
  dismiss(row) {
    const ids = row.items.map((i) => i.id);
    this.markSeen(...ids);
    const dismissed = shared("slack.dismissed") ?? [];
    const add = ids.filter((id) => !dismissed.includes(id));
    if (add.length) setShared("slack.dismissed", [...dismissed, ...add]);
  }

  markSeen(...ids) {
    const seen = shared("slack.seen") ?? [];
    const add = ids.filter((id) => !seen.includes(id));
    if (add.length) setShared("slack.seen", [...seen, ...add]);
  }

  open(item) {
    this.markSeen(item.id);
    if (item.link) exec("open", [item.link]).catch(() => null);
  }

  // Decision 10: one send at a time; seen only after `herdr-app do` succeeds.
  send(item, cx) {
    if (this.sending) return;
    this.sending = item.id;
    cx.notify();
    cx.spawn(async (cx) => {
      await sendToAgent(item, {
        spaces: spaces(),
        home: home(),
        exec,
        notify,
        markSeen: (id) => this.markSeen(id),
        settings: shared("slack.agent"),
        agents: this.agents,
        context: (i) => this.context(i),
      });
      this.sending = null;
      cx.notify();
    });
  }

  // Text whose custom emoji (:name: left as text) are dimmed. Text without one stays a
  // single string; with one, it flows word by word so the dim name sits inline.
  rich(text, t) {
    const parts = customParts(text);
    if (!parts.some((p) => p.custom)) return text;
    const words = parts.flatMap((p) =>
      p.custom
        ? [p]
        : p.text
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => ({ text: w, custom: false })),
    );
    return h_flex()
      .flex_wrap()
      .gap_x(3.5)
      .children(
        words.map((w) =>
          div()
            .when(w.custom, (el) => el.text_color(t.dim))
            .child(w.text),
        ),
      );
  }

  // A group DM's photos, Slack-style: up to 3 smaller avatars overlapping diagonally in the
  // normal avatar's square, newest sender first, and "+N" when there are more.
  avatarStack(item, t, key) {
    const { shown, more } = stackOf(item),
      size = 21,
      step = shown.length > 2 ? 5.5 : 11;
    const tile = (o, n) =>
      div()
        .absolute()
        .left(n * step)
        .top(n * step)
        .size(size)
        .rounded(5)
        .overflow_hidden()
        .border_1()
        .border_color(t.background)
        .child(
          o.avatar
            ? image(o.avatar).size_full()
            : div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(t.raised)
                .text_size(10)
                .font_semibold()
                .text_color(t.muted)
                .child(
                  (
                    String(o.name).match(/[\p{L}\p{N}]/u)?.[0] ?? "?"
                  ).toUpperCase(),
                ),
        );
    return div()
      .id(`stack-${key}`)
      .relative()
      .size(32)
      .flex_none()
      .tooltip(item.others.map((o) => o.name).join(", "))
      .children(shown.map(tile))
      .when(more > 0, (el) =>
        el.child(
          div()
            .absolute()
            .right(-5)
            .bottom(-4)
            .h(13)
            .px(3)
            .flex()
            .items_center()
            .rounded(4)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .text_size(8.5)
            .text_color(t.foreground)
            .child(`+${more}`),
        ),
      );
  }

  // One row per conversation or thread: the newest message, its time, and the unread count.
  row(r, now, t) {
    const item = r.latest,
      stop = (_e, cx) => cx.stop_propagation();
    const title =
      r.kind === "dm"
        ? item.name
        : r.kind === "group"
          ? r.name
          : `#${r.name}${r.thread ? " · thread" : ""}`;
    const preview =
      r.kind === "dm" ? item.text : `${item.sender}: ${item.text}`;
    const initial = (
      String(item.sender).match(/[\p{L}\p{N}]/u)?.[0] ?? "?"
    ).toUpperCase();
    const sending = this.sending === item.id,
      fresh = r.unread > 0;
    // Compact icon actions, drawn over the row's top right while it is hovered (Slack-style),
    // so they never add height to the row. Send and Open act on the newest message.
    const action = (id, icon, tip, enabled, fn) =>
      div()
        .id(`${id}-${r.key}`)
        .size(26)
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(enabled ? t.muted : t.dim)
        .tooltip(tip)
        .when(enabled, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)),
        )
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (enabled) fn(cx);
        })
        .child(icon);
    const actions = () =>
      h_flex()
        .absolute()
        .top(4)
        .right(8)
        .p(2)
        .gap(1)
        .rounded(8)
        .bg(t.popover)
        .border_1()
        .border_color(t.border)
        .child(
          action(
            "open",
            svg("mods/slack/open.svg").size(14),
            "Open in Slack",
            Boolean(item.link),
            () => this.open(item),
          ),
        )
        .child(
          action(
            "send",
            sending
              ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)
              : svg("mods/slack/send.svg").size(14),
            sending ? "Sending…" : "Send to agent",
            !this.sending,
            (cx) => this.send(item, cx),
          ),
        )
        .child(
          action(
            "dismiss",
            svg("mods/slack/dismiss.svg").size(14),
            r.items.length > 1
              ? `Dismiss ${r.items.length} messages`
              : "Dismiss",
            true,
            () => this.dismiss(r),
          ),
        );
    return (
      h_flex()
        .id(`row-${r.key}`)
        .relative()
        .w_full()
        .flex_none()
        .gap(10)
        .px(10)
        .py(7)
        .items_start()
        .rounded(8)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((hovered, cx) => {
          if (hovered) this.hovered = r.key;
          else if (this.hovered === r.key) this.hovered = null;
          cx.notify();
        })
        .on_click((_e, cx) => this.openRow(r, cx))
        // A group DM's stack of photos; else the newest sender's picture, else the initial.
        .child(
          r.kind === "group" && item.others?.length
            ? this.avatarStack(item, t, r.key)
            : item.avatar
              ? image(item.avatar).size(32).flex_none().rounded(6)
              : div()
                  .size(32)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .bg(t.raised)
                  .border_1()
                  .border_color(t.border)
                  .text_size(13)
                  .font_semibold()
                  .text_color(t.muted)
                  .child(initial),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(
              h_flex()
                .h(17)
                .gap(6)
                .items_center()
                .child(
                  div()
                    .min_w(0)
                    .flex_1()
                    .truncate()
                    .text_size(12.5)
                    .text_color(t.foreground)
                    .when(fresh, (el) => el.font_semibold())
                    .child(title),
                )
                .child(
                  div()
                    .flex_none()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(ago(item.ts, now)),
                )
                .when(fresh, (el) =>
                  el.child(
                    div()
                      .h(16)
                      .min_w(16)
                      .px(5)
                      .flex_none()
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(8)
                      .bg(t.accent)
                      .text_color(t.accent_foreground)
                      .text_size(10)
                      .child(String(r.unread)),
                  ),
                ),
            )
            // Exactly two lines: the box is two line heights tall, so no line is cut through.
            .child(
              div()
                .max_h(34)
                .line_height("17px")
                .overflow_hidden()
                .text_size(12)
                .text_color(fresh ? t.foreground : t.muted)
                .child(this.rich(preview || "(no text)", t)),
            )
            .when(Boolean(item.thumb), (el) => {
              const size = fit(
                (item.file ?? item.media)?.w,
                (item.file ?? item.media)?.h,
              );
              return el.child(
                div()
                  .id(`thumb-${r.key}`)
                  .mt(4)
                  .w(size.w)
                  .h(size.h)
                  .rounded(6)
                  .overflow_hidden()
                  .border_1()
                  .border_color(t.border)
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    this.open(item);
                  })
                  .child(image(item.thumb).size_full()),
              );
            }),
        )
        .when(this.hovered === r.key || sending, (el) => el.child(actions()))
    );
  }

  renderPanel(t) {
    const all = items(),
      seen = seenSet(),
      dismissed = dismissedSet(),
      f = filters(),
      now = Date.now(),
      status = shared("slack.status");
    const shown = visible(all, f, dismissed),
      rows = groupRows(shown, seen);
    // Tabs, the Unread toggle and the tab counts work on rows; the unread total counts messages.
    const keep = (r) => !this.unreadOnly || r.unread > 0;
    const TABS = [
      { id: "all", label: "All", pick: () => true },
      { id: "mentions", label: "Mentions", pick: (r) => r.mention },
      { id: "dms", label: "DMs", pick: (r) => r.kind !== "channel" },
    ];
    const tab = TABS.find((x) => x.id === this.tab) ?? TABS[0];
    const list = rows.filter((r) => tab.pick(r) && keep(r));
    const count = (x) => rows.filter((r) => x.pick(r) && keep(r)).length;
    const unreadTotal = shown.filter((i) => unread(i, seen)).length;
    const problem = status && status.state !== "ok" ? status.message : null;
    const field = (id, label, state) =>
      v_flex()
        .gap(4)
        .child(div().text_size(11).text_color(t.muted).child(label))
        .child(
          div()
            .id(id)
            .h(28)
            .px(8)
            .flex()
            .items_center()
            .rounded(7)
            .border_1()
            .border_color(t.border)
            .cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(
              Input.new(state).h_full().text_size(12).text_color(t.foreground),
            ),
        );
    const empty =
      problem && !all.length
        ? problem
        : !all.length
          ? "No DMs or mentions yet."
          : this.unreadOnly
            ? "Nothing unread here."
            : "Nothing here.";

    return v_flex()
      .id("slack")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .track_focus(this.handle)
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().font_semibold().child("Slack"))
          .child(
            div()
              .px(5)
              .py(1)
              .rounded(4)
              .border_1()
              .border_color(t.border)
              .text_size(10)
              .text_color(t.muted)
              .child(`${unreadTotal} unread`),
          )
          .child(div().flex_1())
          .child(
            div()
              .id("slack-filters")
              .size(26)
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .text_color(this.showFilters ? t.foreground : t.muted)
              .bg(this.showFilters ? t.selected : t.background)
              .hover((s) => s.bg(t.hover))
              .tooltip("Channel filters")
              .on_click((_e, cx) => {
                if (this.showFilters) this.saveFilters();
                this.showFilters = !this.showFilters;
                cx.notify();
              })
              .child(svg("mods/workspace-chrome/settings.svg").size(14)),
          ),
      )
      .when(this.showFilters, (el) =>
        el.child(
          v_flex()
            .flex_none()
            .gap(8)
            .p(12)
            .border_b(1)
            .border_color(t.border)
            .child(field("slack-include", "Include channels", this.include))
            .child(
              field(
                "slack-exclude",
                "Exclude channels, people or bots",
                this.exclude,
              ),
            )
            .child(
              div()
                .text_size(11)
                .text_color(t.dim)
                .child(
                  "Include: channels only; it never hides a DM. Exclude: a channel by name, a DM by the person's or bot's name, a group DM by its names (*notetaker*). Comma-separated; * is any run, ? one character. Exclude wins. Enter saves.",
                ),
            )
            .child(this.agentBox(t, field))
            .when(dismissed.size > 0, (el) =>
              el.child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(
                    div()
                      .flex_1()
                      .text_size(11)
                      .text_color(t.muted)
                      .child(`${dismissed.size} dismissed`),
                  )
                  .child(
                    div()
                      .id("slack-undismiss")
                      .h(24)
                      .px(8)
                      .flex()
                      .items_center()
                      .rounded(6)
                      .border_1()
                      .border_color(t.border)
                      .cursor_pointer()
                      .text_size(11)
                      .text_color(t.foreground)
                      .hover((s) => s.bg(t.hover))
                      .on_click(() => setShared("slack.dismissed", []))
                      .child("Clear dismissed"),
                  ),
              ),
            ),
        ),
      )
      .child(
        h_flex()
          .flex_none()
          .h(36)
          .px(10)
          .gap(4)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .children(
            TABS.map((x) => {
              const on = x.id === tab.id,
                n = count(x);
              return h_flex()
                .id(`tab-${x.id}`)
                .h(26)
                .px(9)
                .gap(5)
                .items_center()
                .rounded(6)
                .cursor_pointer()
                .text_size(12)
                .bg(on ? t.selected : t.background)
                .text_color(on ? t.foreground : t.muted)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.tab = x.id;
                  cx.notify();
                })
                .child(x.label)
                .when(n > 0, (el) =>
                  el.child(
                    div().text_size(10).text_color(t.dim).child(String(n)),
                  ),
                );
            }),
          )
          .child(div().flex_1())
          .child(
            h_flex()
              .id("slack-unread")
              .h(26)
              .px(9)
              .gap(6)
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .text_size(12)
              .bg(this.unreadOnly ? t.selected : t.background)
              .text_color(this.unreadOnly ? t.foreground : t.muted)
              .hover((s) => s.bg(t.hover))
              .tooltip(
                this.unreadOnly ? "Showing unread only" : "Show unread only",
              )
              .on_click((_e, cx) => {
                this.unreadOnly = !this.unreadOnly;
                localStorage.setItem("unreadOnly", this.unreadOnly ? "1" : "0");
                cx.notify();
              })
              .child(
                div()
                  .size(7)
                  .rounded_full()
                  .when(this.unreadOnly, (el) => el.bg(t.accent))
                  .when(!this.unreadOnly, (el) =>
                    el.border_1().border_color(t.dim),
                  ),
              )
              .child("Unread"),
          ),
      )
      .when(Boolean(problem) && all.length > 0, (el) =>
        el.child(
          div()
            .flex_none()
            .px(14)
            .py(6)
            .border_b(1)
            .border_color(t.border)
            .text_size(11)
            .text_color(t.dim)
            .child(problem),
        ),
      )
      .child(
        div()
          .flex_1()
          .min_h(0)
          .relative()
          .child(
            v_flex()
              .id("slack-list")
              .absolute()
              .inset_0()
              .overflow_y_scroll()
              .track_scroll(this.listScroll)
              .p(6)
              .gap(2)
              .children(list.map((r) => this.row(r, now, t)))
              .when(!list.length, (el) =>
                el.child(
                  div().p(10).text_size(12).text_color(t.dim).child(empty),
                ),
              ),
          )
          .child(Scrollbar.vertical("slack-list").absolute().inset_0()),
      );
  }

  // Send to agent settings: the installed agents as chips, then the model field with
  // suggestions. An agent without a known model flag gets no model.
  agentBox(t, field) {
    const s = this.agentSettings(),
      installed = this.agents.filter((a) => a.installed),
      list = installed.length
        ? installed
        : [{ key: "claude", name: "Claude Code", icon: null }],
      flag = modelFlag(s.agent);
    const chip = (id, label, on, fn, icon = null) =>
      h_flex()
        .id(id)
        .h(24)
        .px(8)
        .gap(5)
        .items_center()
        .rounded(6)
        .border_1()
        .border_color(on ? t.accent : t.border)
        .bg(on ? t.selected : t.background)
        .text_size(11.5)
        .text_color(on ? t.foreground : t.muted)
        .cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => fn(cx))
        .when(Boolean(icon), (el) => el.child(icon))
        .child(label);
    const icon = (a) =>
      !a.icon
        ? null
        : a.tint
          ? svg(a.icon).size(12).text_color(t.foreground)
          : image(a.icon).size(12);
    return v_flex()
      .gap(6)
      .pt(4)
      .border_t(1)
      .border_color(t.border)
      .child(
        div().pt(6).text_size(11).text_color(t.muted).child("Send to agent"),
      )
      .child(
        h_flex()
          .flex_wrap()
          .gap(4)
          .children(
            list.map((a) =>
              chip(
                `agent-${a.key}`,
                a.name,
                a.key === s.agent,
                (cx) => this.pickAgent(a.key, cx),
                icon(a),
              ),
            ),
          ),
      )
      .when(!list.some((a) => a.key === s.agent), (el) =>
        el.child(
          div()
            .text_size(11)
            .text_color(t.blocked)
            .child(`"${s.agent}" is not installed. Pick another agent.`),
        ),
      )
      .child(
        flag
          ? field("slack-model", "Model", this.model)
          : v_flex()
              .gap(4)
              .child(div().text_size(11).text_color(t.muted).child("Model"))
              .child(
                div()
                  .h(28)
                  .px(8)
                  .flex()
                  .items_center()
                  .rounded(7)
                  .border_1()
                  .border_color(t.border)
                  .text_size(12)
                  .text_color(t.dim)
                  .child("model not supported for this agent"),
              ),
      )
      .when(Boolean(flag && this.modelError), (el) =>
        el.child(
          div().text_size(11).text_color(t.blocked).child(this.modelError),
        ),
      )
      .when(Boolean(flag && MODELS[s.agent]), (el) =>
        el.child(
          h_flex()
            .flex_wrap()
            .gap(4)
            .children(
              MODELS[s.agent].map((m) =>
                chip(`model-${m}`, m, m === s.model, (cx) => {
                  this.model.set_value(m);
                  this.saveModel(cx);
                }),
              ),
            ),
        ),
      )
      .child(
        div()
          .text_size(11)
          .text_color(t.dim)
          .child(
            flag
              ? "Empty: the agent's own default. Enter saves. Claude reads Slack itself; other agents get the conversation in the task."
              : "Other agents get the conversation in the task.",
          ),
      );
  }

  // One message: avatar and name unless it continues the same sender's run, full text,
  // image thumbnails, other files as chips, and "N replies" outside a thread view.
  message(m, v, t, now) {
    const avatar =
      m.face && this.listAvatars.has(m.face.name)
        ? `${CACHE}/avatars/${m.face.name}`
        : m.face && this.viewHave.avatars.has(m.face.name)
          ? `${CACHE}/view/avatars/${m.face.name}`
          : null;
    const initial = (
      String(m.sender).match(/[\p{L}\p{N}]/u)?.[0] ?? "?"
    ).toUpperCase();
    const link = permalink(
      this.viewRow?.latest?.link,
      v.ch,
      m.ts,
      v.mode === "thread" ? v.thread : null,
    );
    const highlight = v.mode !== "history" && m.ts === v.anchor;
    return h_flex()
      .id(`msg-${m.ts}`)
      .w_full()
      .flex_none()
      .gap(10)
      .px(12)
      .pt(m.cont ? 2 : 8)
      .pb(2)
      .items_start()
      .when(highlight, (el) => el.bg(t.selected))
      .child(
        m.cont
          ? div().w(32).flex_none()
          : avatar
            ? image(avatar).size(32).flex_none().rounded(6)
            : div()
                .size(32)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(6)
                .bg(t.raised)
                .border_1()
                .border_color(t.border)
                .text_size(13)
                .font_semibold()
                .text_color(t.muted)
                .child(initial),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .when(!m.cont, (el) =>
            el.child(
              h_flex()
                .gap(8)
                .items_center()
                .child(
                  div()
                    .min_w(0)
                    .truncate()
                    .text_size(12.5)
                    .font_semibold()
                    .text_color(t.foreground)
                    .child(m.sender),
                )
                .child(
                  div()
                    .flex_none()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(clock(m.ts, now)),
                ),
            ),
          )
          // Slack mrkdwn as CommonMark. Links open only on http(s) and mailto. The
          // default UI font has no bold or italic face; the system font has both.
          .when(Boolean(m.md), (el) =>
            el.child(
              TextView.markdown(`md-${m.ts}`, m.md)
                .font_family(".SystemUIFont")
                .selectable(true)
                .text_size(12.5)
                .text_color(t.foreground)
                .on_link_click((url) => {
                  if (linkable(url)) exec("open", [url]).catch(() => null);
                }),
            ),
          )
          // Slack files' thumbnails, then public media such as GIPHY GIFs.
          .children(
            [
              ...m.images.map((f) => ["files", f]),
              ...m.media.map((f) => ["media", f]),
            ]
              .filter(([kind, f]) => this.viewHave[kind].has(f.name))
              .map(([kind, f]) => {
                const size = fit(f.w, f.h);
                return div()
                  .id(`img-${m.ts}-${f.name}`)
                  .mt(2)
                  .w(size.w)
                  .h(size.h)
                  .rounded(6)
                  .overflow_hidden()
                  .border_1()
                  .border_color(t.border)
                  .cursor_pointer()
                  .on_click(() => exec("open", [link]).catch(() => null))
                  .child(image(`${CACHE}/view/${kind}/${f.name}`).size_full());
              }),
          )
          .when(m.files.length > 0, (el) =>
            el.child(
              h_flex()
                .flex_wrap()
                .gap(4)
                .mt(2)
                .children(
                  m.files.map((name, n) =>
                    h_flex()
                      .id(`file-${m.ts}-${n}`)
                      .h(22)
                      .px(7)
                      .gap(5)
                      .items_center()
                      .rounded(6)
                      .border_1()
                      .border_color(t.border)
                      .text_size(11)
                      .text_color(t.muted)
                      .child(
                        svg("mods/workspace-chrome/file-text.svg").size(12),
                      )
                      .child(div().max_w(200).truncate().child(name)),
                  ),
                ),
            ),
          )
          // Reactions, read-only: emoji and count, outlined in the accent when I reacted.
          .when(m.reactions.length > 0, (el) =>
            el.child(
              h_flex()
                .flex_wrap()
                .gap(4)
                .mt(3)
                .children(
                  m.reactions.map((r, n) =>
                    h_flex()
                      .id(`react-${m.ts}-${n}`)
                      .h(22)
                      .px(7)
                      .gap(4)
                      .items_center()
                      .rounded(11)
                      .border_1()
                      .border_color(r.mine ? t.accent : t.border)
                      .bg(r.mine ? t.selected : t.raised)
                      .tooltip(`:${r.name}:`)
                      .child(
                        r.emoji.startsWith(":")
                          ? div()
                              .text_size(10.5)
                              .text_color(t.dim)
                              .child(r.emoji)
                          : div().text_size(13).child(r.emoji),
                      )
                      .child(
                        div()
                          .text_size(11)
                          .text_color(r.mine ? t.foreground : t.muted)
                          .child(String(r.count)),
                      ),
                  ),
                ),
            ),
          )
          .when(m.replies > 0 && v.mode !== "thread", (el) =>
            el.child(
              div()
                .id(`replies-${m.ts}`)
                .mt(2)
                .text_size(11.5)
                .text_color(t.accent)
                .cursor_pointer()
                .on_click((_e, cx) => this.openThread(m.ts, cx))
                .child(m.replies === 1 ? "1 reply" : `${m.replies} replies`),
            ),
          ),
      );
  }

  renderView(t) {
    const v = this.views.at(-1),
      row = this.viewRow,
      item = row?.latest,
      now = Date.now();
    const link =
      this.views.length > 1
        ? permalink(item?.link, v.ch, v.thread, v.thread)
        : item?.link;
    const sending = this.sending === item?.id;
    const icon = (id, glyph, tip, enabled, fn) =>
      div()
        .id(id)
        .size(28)
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .flex_none()
        .text_color(enabled ? t.muted : t.dim)
        .tooltip(tip)
        .when(enabled, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)),
        )
        .on_click((_e, cx) => {
          if (enabled) fn(cx);
        })
        .child(glyph);
    const more = v.mode === "history" && v.cursor;
    const reply = this.replies.get(replyTarget(v).key);
    const note =
      v.error ??
      (v.loading && !v.messages.length
        ? "Loading…"
        : !v.messages.length
          ? "No messages."
          : null);
    return (
      v_flex()
        .id("slack")
        .size_full()
        .min_h(0)
        .rounded(10)
        .overflow_hidden()
        .bg(t.background)
        .border_1()
        .border_color(t.border)
        .text_color(t.foreground)
        .text_size(13)
        .track_focus(this.handle)
        // Esc leaves the view; with text in the composer, the first Esc only blurs it.
        .on_key_down((e, cx) => {
          if (e.key !== "escape") return;
          cx.stop_propagation();
          if (this.typing && reply?.state.value().trim()) {
            this.handle.focus();
            this.typing = false;
            cx.notify();
          } else this.back(cx);
        })
        .child(
          h_flex()
            .h(42)
            .flex_none()
            .px(8)
            .gap(6)
            .items_center()
            .border_b(1)
            .border_color(t.border)
            .child(
              icon(
                "view-back",
                svg("mods/workspace-chrome/chevron-left.svg").size(16),
                "Back (Esc)",
                true,
                (cx) => this.back(cx),
              ),
            )
            .when(row?.kind === "group" && item?.others?.length > 0, (el) =>
              el.child(this.avatarStack(item, t, "view")),
            )
            .child(
              div().flex_1().min_w(0).truncate().font_semibold().child(v.title),
            )
            .when(v.loading, (el) =>
              el.child(
                svg("mods/workspace-chrome/spinner.svg")
                  .size(12)
                  .flex_none()
                  .text_color(t.dim)
                  .spin(900),
              ),
            )
            .child(
              icon(
                "view-open",
                svg("mods/slack/open.svg").size(14),
                "Open in Slack",
                Boolean(link),
                () => exec("open", [link]).catch(() => null),
              ),
            )
            .child(
              icon(
                "view-send",
                sending
                  ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)
                  : svg("mods/slack/send.svg").size(14),
                sending ? "Sending…" : "Send to agent",
                Boolean(item) && !this.sending,
                (cx) => this.send(item, cx),
              ),
            ),
        )
        .child(
          div()
            .flex_1()
            .min_h(0)
            .relative()
            .child(
              v_flex()
                .id("slack-view")
                .absolute()
                .inset_0()
                .overflow_y_scroll()
                .track_scroll(this.viewScroll)
                .pb(10)
                // Scrolling up leaves the bottom: a refresh then keeps the position.
                .on_scroll_wheel((e) => {
                  if (e.delta.y > 0) this.stick = false;
                })
                .when(Boolean(more), (el) =>
                  el.child(
                    div()
                      .id("view-older")
                      .flex_none()
                      .mx(12)
                      .my(8)
                      .h(26)
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(6)
                      .border_1()
                      .border_color(t.border)
                      .text_size(11.5)
                      .text_color(t.muted)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.loadView(cx, { older: true }))
                      .child(v.loading ? "Loading…" : "Load older"),
                  ),
                )
                .children(v.messages.map((m) => this.message(m, v, t, now)))
                .when(Boolean(note), (el) =>
                  el.child(
                    div().p(14).text_size(12).text_color(t.dim).child(note),
                  ),
                ),
            )
            .child(Scrollbar.vertical("slack-view").absolute().inset_0()),
        )
        .when(Boolean(reply), (el) => el.child(this.replyBox(reply, t)))
    );
  }

  // The composer, Slack-style: the error line, then the input and Send.
  replyBox(r, t) {
    const busy = this.posting === r.target.key,
      can = !this.posting && !r.empty;
    return v_flex()
      .flex_none()
      .px(10)
      .pt(4)
      .pb(10)
      .gap(4)
      .when(Boolean(r.error), (el) =>
        el.child(
          div()
            .id("reply-error")
            .px(2)
            .truncate()
            .text_size(11)
            .text_color(t.blocked)
            .tooltip(r.error)
            .child(r.error),
        ),
      )
      .child(
        h_flex()
          .id("reply-box")
          .key_context("SlackReply")
          .on_action("slack-reply-send", (_e, cx) => this.sendReply(r, cx))
          .on_action("slack-reply-line", () => r.state.replace("\n"))
          .items_end()
          .gap(6)
          .pl(10)
          .pr(5)
          .py(5)
          .rounded(8)
          .border_1()
          .border_color(this.typing ? t.accent : t.border)
          .bg(t.background)
          .cursor_text()
          .on_click(() => r.state.focus())
          .child(
            div()
              .flex_1()
              .min_w(0)
              .py(3)
              .child(
                Textarea.new(r.state)
                  .w_full()
                  .text_size(12.5)
                  .text_color(t.foreground),
              ),
          )
          .child(
            h_flex()
              .id("reply-send")
              .h(26)
              .px(10)
              .flex_none()
              .items_center()
              .rounded(6)
              .text_size(12)
              .bg(can ? t.accent : t.raised)
              .text_color(can ? t.accent_foreground : t.dim)
              .tooltip(
                busy ? "Sending…" : "Send (Enter). Shift+Enter: new line",
              )
              .when(can, (el) =>
                el.cursor_pointer().hover((s) => s.opacity(0.88)),
              )
              .on_click((_e, cx) => {
                cx.stop_propagation();
                if (can) this.sendReply(r, cx);
              })
              .child(
                busy
                  ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900)
                  : "Send",
              ),
          ),
      );
  }

  render() {
    const t = theme();
    if (this.role === "button") return this.renderButton(t);
    return this.views.length ? this.renderView(t) : this.renderPanel(t);
  }
}
