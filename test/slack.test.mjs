import test from "node:test";
import assert from "node:assert/strict";
import {
  tsCmp, glob, patterns, passes, plain, messageText, threadOf, userIds, channelRefs, toItem, merge, markRead, unread,
  staleConversations, pruneSeen, unreadCount, visible, backoff, sendCommand, sendToAgent,
} from "../mods/slack/lib.js";

const ME = "U0ME"; // the token's own user id, as auth.test reports it
const ch = (name, id = `C${name.toUpperCase()}`) => ({ id, name, is_channel: true });
const match = (channel, ts, extra = {}) => ({ channel, ts, user: "U1", username: "ann", text: "hi", permalink: `https://x.slack.com/archives/${channel.id}/p${ts.replace(".", "")}`, ...extra });

test("ts compares exactly", () => {
  assert.equal(tsCmp("1700000000.000002", "1700000000.000001"), 1);
  assert.equal(tsCmp("1700000000.1", "1700000000.100000"), 0);
  assert.equal(tsCmp("1699999999.999999", "1700000000.000000") < 0, true);
});

test("glob matches the whole name, case-insensitive, # ignored", () => {
  assert.ok(glob("eng-*", "eng-backend"));
  assert.ok(glob("#Eng-*", "ENG-x"));
  assert.ok(glob("team-?", "team-a"));
  assert.ok(!glob("team-?", "team-ab"));
  assert.ok(!glob("eng", "eng-backend"));
  assert.ok(glob("a.b+(c)", "a.b+(c)"));
  assert.ok(!glob("a.b", "axb"));
  assert.deepEqual(patterns(" #eng-*, random  alerts-?,,"), ["eng-*", "random", "alerts-?"]);
});

test("filters: exclude wins, empty include is all, include never hides DMs", () => {
  const c = (name) => ({ kind: "channel", name });
  assert.ok(passes(c("general"), { include: [], exclude: [] }));
  assert.ok(passes(c("eng-x"), { include: ["eng-*"], exclude: [] }));
  assert.ok(!passes(c("random"), { include: ["eng-*"], exclude: [] }));
  assert.ok(!passes(c("eng-noise"), { include: ["eng-*"], exclude: ["*-noise"] }));
  assert.ok(passes({ kind: "dm", name: "noise" }, { include: ["eng-*"], exclude: [] }));
  assert.ok(passes({ kind: "group", name: "a, b" }, { include: ["eng-*"], exclude: [] }));
  // A broken filter shows the item.
  assert.ok(passes(c("x"), { include: [], exclude: { some: () => { throw new Error("bad"); } } }));
});

test("mrkdwn to plain text", () => {
  assert.equal(plain("hey <@U9|bob> see <https://a.b/c|the doc> and <https://x.y>"), "hey @bob see the doc and https://x.y");
  assert.equal(plain("<@U9> in <#C1|general> <!here> &lt;b&gt; &amp;"), "@U9 in #general @here <b> &");
  assert.equal(plain("<@U9>", { U9: "Bob" }), "@Bob");
  assert.equal(plain("a\n\n  b"), "a b");
  assert.equal(plain("<!subteam^S1|@eng>"), "@eng");
  // Search results carry typed angle brackets unescaped; they are not tokens.
  assert.equal(plain("it should always follow this pattern - v<major>.<minor>.<patch>"), "it should always follow this pattern - v<major>.<minor>.<patch>");
  assert.equal(plain("v&lt;major&gt;.&lt;minor&gt; &amp;lt;"), "v<major>.<minor> &lt;");
  assert.equal(plain("see <mailto:a@b.c|a@b.c> or <https://x.y/a?b=1&amp;c=2>"), "see a@b.c or https://x.y/a?b=1&c=2");
});

test("preview text from attachments or blocks when text is empty", () => {
  const github = {
    text: "",
    attachments: [{
      pretext: "Deployment to <https://github.com/o/r/actions/runs/1|dev> by <https://github.com/octocat|octocat>",
      fallback: "[o/r] Deployed <https://github.com/o/r/commit/c|`cde8481 (dev)`> to dev",
    }],
  };
  assert.equal(plain(messageText(github)), "Deployment to dev by octocat");
  assert.equal(plain(messageText({ text: "", attachments: [{ fallback: "[o/r] Deployed <https://x|`cde8481`>" }] })), "[o/r] Deployed `cde8481`");
  assert.equal(messageText({ text: "", attachments: [{ title: "PR #1", text: "body" }] }), "PR #1 · body");
  const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Alert *fired*" } }, { type: "context", elements: [{ type: "plain_text", text: "prod" }] }];
  assert.equal(messageText({ text: " ", blocks }), "Alert *fired* · prod");
  assert.equal(messageText({ text: "hi", attachments: [{ fallback: "x" }] }), "hi");
  assert.equal(toItem({ ...match(ch("auto-deploys"), "1.000009"), ...github }).text, "Deployment to dev by octocat");
});

test("thread id from the permalink", () => {
  assert.equal(threadOf("https://x.slack.com/archives/C1/p1700000001000200?thread_ts=1700000000.000100&cid=C1"), "1700000000.000100");
  assert.equal(threadOf("https://x.slack.com/archives/C1/p1700000001000200"), null);
  const reply = toItem(match(ch("eng"), "1700000001.000200", { permalink: "https://x/p1?thread_ts=1700000000.000100&cid=C1" }));
  assert.equal(reply.thread, "1700000000.000100");
  const parent = toItem(match(ch("eng"), "1700000000.000100", { permalink: "https://x/p1?thread_ts=1700000000.000100&cid=C1" }));
  assert.equal(parent.thread, null);
});

test("items: kinds, labels, names, mention flag, preview cap", () => {
  const dm = toItem(match({ id: "D1", is_im: true, user: "U2", name: "U2" }, "1.000001"), { names: { U2: "Bea", U1: "Ann" } });
  assert.equal(dm.kind, "dm");
  assert.equal(dm.name, "Bea");
  assert.equal(dm.sender, "Ann");
  const g = toItem(match({ id: "G1", is_mpim: true, name: "mpdm-ann--bea--cy-1" }, "1.000002"));
  assert.equal(g.kind, "group");
  assert.equal(g.name, "ann, bea, cy");
  const m = toItem(match(ch("eng"), "1.000003", { text: `hey <@${ME}> ${"x".repeat(400)}` }), { me: ME });
  assert.equal(toItem(match(ch("eng"), "1.000004", { text: `hey <@${ME}>` })).mention, false); // no user id yet: nothing matches
  assert.equal(m.mention, true);
  assert.equal(m.text.length, 300);
  assert.deepEqual(userIds([match({ id: "D1", is_im: true, user: "U2" }, "1.1", { text: "<@U3|c> <@W4>" })]).sort(), ["U1", "U2", "U3", "W4"]);
});

test("merge de-duplicates by channel and ts and keeps the mention flag", () => {
  const a = toItem(match(ch("eng"), "1.000001"), { mention: true });
  const b = toItem(match(ch("eng"), "1.000001"));
  const c = toItem(match(ch("eng"), "2.000001"));
  const out = merge([a], [b, c], {});
  assert.deepEqual(out.map((i) => i.ts), ["2.000001", "1.000001"]);
  assert.equal(out[1].mention, true);
});

test("an excluded-channel flood cannot push out a DM", () => {
  const dm = toItem(match({ id: "D1", is_im: true, user: "U2" }, "1000.000001"));
  const flood = Array.from({ length: 200 }, (_, n) => toItem(match(ch("alerts-prod"), `${2000 + n}.000001`), { mention: true }));
  const out = merge([dm], flood, { include: [], exclude: ["alerts-*"] });
  assert.deepEqual(out.map((i) => i.id), ["D1:1000.000001"]);
  // Without the exclude the cap keeps only the newest 150.
  assert.equal(merge([dm], flood, {}).length, 150);
});

test("unread: last_read for top-level, seen for thread replies", () => {
  const top = toItem(match(ch("eng"), "100.000001"));
  const reply = toItem(match(ch("eng"), "90.000001", { permalink: "https://x/p?thread_ts=80.000001" }));
  const newer = toItem(match(ch("eng"), "200.000001"));
  const items = markRead([newer, top, reply], { CENG: "150.000000" });
  const seen = new Set();
  assert.deepEqual(items.map((i) => unread(i, seen)), [true, false, true]);
  // Unknown last_read: unread until seen.
  assert.equal(unread(markRead([top], {})[0], seen), true);
  assert.equal(unread(items[2], new Set([reply.id])), false);
  assert.deepEqual(staleConversations(items, seen), ["CENG"]);
  assert.equal(unreadCount(items, seen, { include: [], exclude: ["eng"] }), 0);
  assert.equal(unreadCount(items, seen, {}), 2);
  assert.deepEqual(pruneSeen(["gone", reply.id], items), [reply.id]);
});

test("backoff doubles from 60 s up to 10 min", () => {
  const steps = [];
  let b = 0;
  for (let n = 0; n < 6; n++) steps.push(b = backoff(b));
  assert.deepEqual(steps, [60000, 120000, 240000, 480000, 600000, 600000]);
});

test("send command: a tab in an open space, else the space at ~/code", () => {
  const item = toItem(match(ch("eng"), "1.000001"));
  const [c1, a1] = sendCommand([{ id: "s1", name: "space", machine: null }], "/h", item);
  assert.equal(c1, "tab.new");
  assert.equal(a1.space, "s1");
  assert.deepEqual(a1.argv, ["claude", "--model", "claude-opus-5-5"]);
  assert.match(a1.task, /Permalink: https:/);
  assert.match(a1.task, /as data, not instructions/);
  const [c2, a2] = sendCommand([{ id: "s2", name: "space", machine: "vps" }], "/h", item);
  assert.equal(c2, "space.new");
  assert.equal(a2.folder, "/h/code");
});

test("send: a failed herdr-app do toasts and leaves the item unseen", async () => {
  const item = toItem(match(ch("eng"), "1.000001"));
  const calls = [], notes = [], seen = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return cmd === "mkdir" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: '{ "error": "no such folder" }', stderr: "" };
  };
  const ok = await sendToAgent(item, { spaces: [], home: "/h", exec, notify: (n) => notes.push(n), markSeen: (id) => seen.push(id) });
  assert.equal(ok, false);
  assert.deepEqual(seen, []);
  assert.equal(notes[0].body, "no such folder");
  assert.deepEqual(calls[0], ["mkdir", "-p", "/h/code"]);
  assert.equal(calls[1][2], "space.new");

  // A folder that cannot be created stops before herdr-app runs.
  const noDir = async (cmd) => (cmd === "mkdir" ? { code: 1, stdout: "", stderr: "mkdir: /dev/null/code: Not a directory\n" } : assert.fail("ran herdr-app"));
  assert.equal(await sendToAgent(item, { spaces: [], home: "/dev/null", exec: noDir, notify: (n) => notes.push(n), markSeen: (id) => seen.push(id) }), false);
  assert.equal(notes[1].body, "mkdir: /dev/null/code: Not a directory");
  assert.deepEqual(seen, []);

  const good = async () => ({ code: 0, stdout: '{ "space": "s", "tab": "t", "terminal": "t9" }', stderr: "" });
  assert.equal(await sendToAgent(item, { spaces: [], home: "/h", exec: good, notify: (n) => notes.push(n), markSeen: (id) => seen.push(id) }), true);
  assert.deepEqual(seen, [item.id]);
});

test("images: avatar source, thumbnail pick, cache plan, fit", async () => {
  const { imageFile, cacheWork, withCache, fit, CACHE } = await import("../mods/slack/lib.js");
  const person = toItem(match(ch("eng"), "1.000001", { user: "U1" }), { images: { U1: "https://avatars.slack-edge.com/a/b_72.jpg" } });
  assert.deepEqual(person.face, { name: "U1.jpg", url: "https://avatars.slack-edge.com/a/b_72.jpg" });
  const bot = toItem(match(ch("eng"), "1.000002", { user: undefined, bot_id: "B9", icons: { image_48: "https://x/i.png" } }));
  assert.equal(bot.face.name, "bot-B9.png");
  assert.equal(toItem(match(ch("eng"), "1.000003")).face, null);

  const files = [
    { id: "F0", mimetype: "application/pdf", thumb_pdf: "https://files/p" },
    { id: "F1", mimetype: "image/png", thumb_160: "https://files/t160.png", thumb_480: "https://files/t480.png", thumb_480_w: 480, thumb_480_h: 240 },
  ];
  assert.deepEqual(imageFile({ files }), { name: "F1.png", url: "https://files/t480.png", w: 480, h: 240 });
  assert.equal(imageFile({ files: [files[0]] }), null);

  const items = [{ ...person, file: { name: "F1.png", url: "u" } }, bot];
  const have = { avatars: new Set(["U1.jpg", "U7.png"]), files: new Set(["F0.png"]) };
  const { stale, missing } = cacheWork(items, have);
  assert.deepEqual(stale, { avatars: ["U7.png"], files: ["F0.png"], media: [] });
  assert.deepEqual(missing.map((j) => `${j.kind}/${j.name}`), ["avatars/bot-B9.png", "files/F1.png"]);
  // The same file referenced twice is fetched once.
  assert.equal(cacheWork([person, person], { avatars: new Set(), files: new Set() }).missing.length, 1);
  const shown = withCache(items, have);
  assert.equal(shown[0].avatar, `${CACHE}/avatars/U1.jpg`);
  assert.equal(shown[0].thumb, null);
  assert.equal(shown[1].avatar, null);

  assert.deepEqual(fit(360, 64), { w: 260, h: 46 });
  assert.deepEqual(fit(360, 229), { w: 220, h: 140 });
  assert.deepEqual(fit(100, 50), { w: 100, h: 50 });
});

test("dismissed items leave the list and the badge; the id list prunes like seen", () => {
  const a = toItem(match(ch("eng"), "2.000001")), b = toItem(match({ id: "D1", is_im: true, user: "U2" }, "1.000001"));
  const items = [a, b], seen = new Set(), dismissed = new Set([a.id]);
  assert.deepEqual(visible(items, {}, dismissed).map((i) => i.id), [b.id]);
  assert.equal(unreadCount(items, seen, {}, dismissed), 1);
  assert.equal(unreadCount(items, seen, {}), 2);
  assert.deepEqual(visible(items, { exclude: ["eng"] }), [b]);
  assert.deepEqual(pruneSeen([a.id, "C9:gone"], items), [a.id]);
});

test("unnamed channel mentions: looked up by id, shown by name", () => {
  const m = [{ text: "look at <#C0ALERTS> and <#C1|general> and <#C0ALERTS>" }, { text: "<#G9>" }];
  assert.deepEqual(channelRefs(m), ["C0ALERTS", "G9"]);
  assert.equal(plain(m[0].text, { C0ALERTS: "prod-alerts" }), "look at #prod-alerts and #general and #prod-alerts");
  assert.equal(plain("<#C7>"), "#C7");
});

test("rows: one per DM conversation, one per channel thread, newest first", async () => {
  const { groupRows, rowKey } = await import("../mods/slack/lib.js");
  const dm = { id: "D1", is_im: true, user: "U2" }, eng = ch("eng");
  const reply = (ts, root) => ({ permalink: `https://x/p?thread_ts=${root}&cid=CENG` });
  const items = [
    toItem(match(dm, "50.000001")),
    toItem(match(eng, "40.000001", reply("40.000001", "10.000001")), { mention: true }),
    toItem(match(dm, "30.000001")),
    toItem(match(eng, "20.000001"), { mention: true }),               // lone mention
    toItem(match(eng, "10.000001"), { mention: true }),               // the thread's root
    toItem(match(eng, "15.000001", reply("15.000001", "10.000001")), { mention: true }),
  ];
  const seen = new Set([items[2].id]);
  const rows = groupRows(items, seen);
  assert.deepEqual(rows.map((r) => r.key), ["D1", "CENG:10.000001", "CENG:20.000001"]);
  assert.deepEqual(rows.map((r) => r.items.length), [2, 3, 1]);
  assert.deepEqual(rows.map((r) => r.unread), [1, 3, 1]);
  assert.equal(rows[0].latest.ts, "50.000001");
  assert.equal(rows[1].latest.ts, "40.000001");
  assert.equal(rows[1].thread, "10.000001");
  assert.equal(rows[2].thread, null);
  assert.deepEqual(rows.map((r) => r.mention), [false, true, true]);
  assert.equal(rowKey(items[4]), rowKey(items[1]));
});

test("view: what a row opens, thread titles, permalinks", async () => {
  const { viewOf, threadView, permalink } = await import("../mods/slack/lib.js");
  const latest = { ts: "40.000001", name: "Bea" };
  assert.deepEqual(viewOf({ kind: "dm", ch: "D1", latest }), { mode: "history", ch: "D1", title: "Bea" });
  assert.equal(viewOf({ kind: "group", ch: "G1", name: "ann, bea", latest }).title, "ann, bea");
  assert.deepEqual(viewOf({ kind: "channel", ch: "C1", name: "eng", thread: "10.000001", latest }),
    { mode: "thread", ch: "C1", thread: "10.000001", anchor: "40.000001", title: "Thread in #eng" });
  const lone = viewOf({ kind: "channel", ch: "C1", name: "eng", thread: null, latest });
  assert.deepEqual(lone, { mode: "around", ch: "C1", anchor: "40.000001", title: "#eng" });
  assert.equal(threadView(lone, "30.000001").title, "Thread in #eng");
  assert.equal(threadView({ ch: "D1", title: "Bea" }, "30.000001").title, "Thread with Bea");
  assert.equal(threadView(threadView(lone, "1.1"), "2.2").title, "Thread in #eng");
  const base = "https://example.slack.com/archives/C9/p1794744000000100?thread_ts=1&cid=C9";
  assert.equal(permalink(base, "C1", "1794744000.000200"), "https://example.slack.com/archives/C1/p1794744000000200");
  assert.equal(permalink(base, "C1", "2.000002", "1.000001"), "https://example.slack.com/archives/C1/p2000002?thread_ts=1.000001&cid=C1");
});

test("view: messages keep lines, attachments and files; same-sender runs collapse", async () => {
  const { toMessage, collapse, mergeMessages, around, clock } = await import("../mods/slack/lib.js");
  const m = toMessage({
    ts: "100.000001", user: "U1", text: "line one\n\n\n<@U2> said  v<major>\nend",
    attachments: [{ pretext: "Deployed <https://x|dev>" }],
    files: [{ id: "F1", mimetype: "image/png", thumb_360: "https://f/1.png", thumb_360_w: 360, thumb_360_h: 200 }, { id: "F2", mimetype: "application/pdf", name: "spec.pdf" }],
    reply_count: 3,
  }, { names: { U1: "Ann", U2: "Bea" }, images: { U1: "https://a/u1.jpg" } });
  assert.equal(m.sender, "Ann");
  assert.equal(m.text, "line one\n\n@Bea said v<major>\nend\nDeployed dev");
  assert.deepEqual(m.images.map((f) => f.name), ["F1.png"]);
  assert.deepEqual(m.files, ["spec.pdf"]);
  assert.equal(m.replies, 3);
  assert.equal(m.face.name, "U1.jpg");
  const bot = toMessage({ ts: "1.1", bot_id: "B1", text: "", blocks: [{ text: { text: "Alert" } }], bot_profile: { name: "PagerBot", icons: { image_72: "https://i/b.png" } } });
  assert.equal(bot.sender, "PagerBot");
  assert.equal(bot.text, "Alert");
  assert.equal(bot.face.name, "bot-B1.png");

  const seq = [{ ts: "100.0", user: "U1" }, { ts: "160.0", user: "U1" }, { ts: "500.0", user: "U1" }, { ts: "510.0", user: "U2" }, { ts: "520.0", user: null }, { ts: "521.0", user: null }];
  assert.deepEqual(collapse(seq).map((x) => x.cont), [false, true, false, false, false, false]);

  assert.deepEqual(mergeMessages([{ ts: "2.0", v: 1 }, { ts: "1.0" }], [{ ts: "2.0", v: 2 }, { ts: "3.0" }]).map((x) => `${x.ts}${x.v ?? ""}`), ["1.0", "2.02", "3.0"]);
  const before = [{ ts: "50.0" }, { ts: "40.0" }], after = [{ ts: "90.0" }, { ts: "70.0" }, { ts: "60.0" }];
  assert.deepEqual(around(before, after, 2).map((x) => x.ts), ["40.0", "50.0", "60.0", "70.0"]);

  const now = new Date(2026, 10, 15, 18, 0).getTime();
  assert.equal(clock(String(new Date(2026, 10, 15, 9, 5).getTime() / 1000), now), "09:05");
  assert.equal(clock(String(new Date(2026, 10, 12, 14, 32).getTime() / 1000), now), "12 Nov 14:32");
});

test("group DM photos: other members, newest sender first, at most 3 and +N", async () => {
  const { stackOf, cacheWork, withCache } = await import("../mods/slack/lib.js");
  const g = { id: "G1", is_mpim: true, name: "mpdm-me--ann--bea--cy--dee-1" };
  const images = { U1: "https://a/1.png", U3: "https://a/3.jpg" };
  const item = toItem(match(g, "5.000001", { user: "U3" }), { images, names: { U1: "Ann" }, members: { G1: [ME, "U1", "U2", "U3", "U4"] }, me: ME });
  assert.deepEqual(item.others.map((o) => o.id), ["U1", "U2", "U3", "U4"]);
  assert.equal(item.others[0].name, "Ann");
  const { shown, more } = stackOf(item);
  assert.deepEqual(shown.map((o) => o.id), ["U3", "U1", "U2"]);
  assert.equal(more, 1);
  assert.equal(stackOf({ ...item, others: item.others.slice(0, 2) }).more, 0);
  assert.equal(toItem(match({ id: "D1", is_im: true }, "1.1")).others, null);
  // Members' photos are fetched and kept like the sender's.
  const { missing } = cacheWork([item], { avatars: new Set(["U3.jpg"]), files: new Set() });
  assert.deepEqual(missing.map((j) => j.name), ["U1.png"]);
  const cached = withCache([item], { avatars: new Set(["U3.jpg"]), files: new Set() })[0];
  assert.deepEqual(cached.others.map((o) => o.avatar), [null, null, ".slack-cache/avatars/U3.jpg", null]);
  assert.equal(cached.avatar, ".slack-cache/avatars/U3.jpg");
});

test("emoji: short names, aliases and skin tones; unknown names, code and URLs left alone", async () => {
  const { emojify, customParts, emoji } = await import("../mods/slack/lib.js");
  assert.equal(emojify(":blush:"), "😊");
  assert.equal(emojify(":thumbsup: :+1:"), "👍 👍");                // an alias and its short name
  assert.equal(emojify(":+1::skin-tone-3:"), "👍🏼");
  assert.equal(emojify(":v::skin-tone-2:"), "✌🏻");                   // FE0F gives way to the tone
  assert.equal(emoji("heart"), "❤️");
  assert.equal(emojify(":party-parrot: at 10:30:45"), ":party-parrot: at 10:30:45");
  assert.equal(emojify("`a :blush: b` and ```x :wink: y``` :wink:"), "`a :blush: b` and ```x :wink: y``` 😉");
  assert.equal(emojify("see https://x.y/a:b:c :point_down:"), "see https://x.y/a:b:c 👇");
  assert.equal(plain("Thanks buddy :blush::blush: <https://x|link :wink:>"), "Thanks buddy 😊😊 link 😉");
  assert.deepEqual(customParts("ok :party-parrot: 10:30:45"), [{ text: "ok ", custom: false }, { text: ":party-parrot:", custom: true }, { text: " 10:30:45", custom: false }]);
  assert.deepEqual(customParts("plain"), [{ text: "plain", custom: false }]);
});

test("view: reactions as emoji chips, mine marked, custom names kept", async () => {
  const { toMessage } = await import("../mods/slack/lib.js");
  const m = toMessage({ ts: "1.1", user: "U1", text: "ship it :point_down:", reactions: [
    { name: "+1::skin-tone-2", count: 2, users: ["U2", ME] },
    { name: "eyes", count: 1, users: ["U3"] },
    { name: "party-parrot", count: 4, users: ["U4"] },
  ] }, { me: ME });
  assert.equal(m.text, "ship it 👇");
  assert.deepEqual(m.reactions.map((r) => [r.emoji, r.count, r.mine]), [["👍🏻", 2, true], ["👀", 1, false], [":party-parrot:", 4, false]]);
  assert.deepEqual(toMessage({ ts: "1.2", text: "x" }).reactions, []);
});

test("giphy: image blocks become public media, fetched and kept without the token", async () => {
  const { mediaImages, cacheWork, withCache, toMessage } = await import("../mods/slack/lib.js");
  const giphy = { ts: "9.1", user: "U1", text: "", blocks: [
    { type: "image", image_url: "https://media.giphy.com/media/abc123/giphy.gif", image_width: 250, image_height: 204, title: { type: "plain_text", text: "hello there" } },
    { type: "context", elements: [{ type: "mrkdwn", text: "Posted using /giphy" }] },
  ] };
  const [g] = mediaImages(giphy);
  assert.match(g.name, /^m-[0-9a-z]+\.gif$/);
  assert.deepEqual([g.url, g.w, g.h], ["https://media.giphy.com/media/abc123/giphy.gif", 250, 204]);
  assert.equal(mediaImages(giphy)[0].name, g.name);                       // stable name
  assert.deepEqual(mediaImages({ attachments: [{ image_url: "https://example.com/og.png" }] }), []); // link previews are not media
  assert.equal(mediaImages({ attachments: [{ image_url: "https://media.giphy.com/media/x/giphy.gif" }] }).length, 1);
  const m = toMessage(giphy);
  assert.equal(m.text, "hello there\nPosted using /giphy");
  assert.equal(m.media.length, 1);
  const item = toItem({ ...match(ch("eng"), "9.000001"), ...giphy });
  const { missing } = cacheWork([item], { avatars: new Set(), files: new Set() });
  assert.deepEqual(missing.map((j) => `${j.kind}/${j.name}`), [`media/${g.name}`]);
  assert.equal(withCache([item], { avatars: new Set(), files: new Set(), media: new Set([g.name]) })[0].thumb, `.slack-cache/media/${g.name}`);
});

test("exclude hides DMs by person or bot name and group DMs by name (the exclude rule)", () => {
  const bot = toItem(match({ id: "D9", is_im: true, user: "U0NOTE" }, "1.000001", { user: "U0NOTE", username: "notetaker" }),
    { names: { U0NOTE: "Notetaker" }, aliases: { U0NOTE: ["Notetaker AI", "notetaker"] } });
  assert.equal(bot.name, "Notetaker");
  const f = (exclude, include = []) => ({ include, exclude });
  assert.ok(!passes(bot, f(["Notetaker"])));
  assert.ok(!passes(bot, f(["note*"])));
  assert.ok(!passes(bot, f(["notetaker ai"])));                    // real name
  assert.ok(!passes({ kind: "dm", name: "U9", sender: "x", aka: ["notetaker"] }, f(["notetaker"]))); // handle only
  assert.ok(passes(bot, f(["auto-*", "bea"])));                 // no match stays
  assert.ok(passes(bot, f([], ["eng-*"])));                     // include never hides a DM
  const group = { kind: "group", name: "ann, notetaker, bob" };
  assert.ok(!passes(group, f(["*notetaker*"])));
  assert.ok(passes(group, f(["notetaker"])));                      // whole-name match, as for channels
  assert.ok(passes(group, f([], ["eng-*"])));
  // Channels unchanged.
  assert.ok(!passes({ kind: "channel", name: "auto-deploys" }, f(["auto-*"])));
  assert.ok(!passes({ kind: "channel", name: "random" }, f([], ["eng-*"])));
  assert.ok(!passes({ kind: "channel", name: "eng-noise" }, f(["*-noise"], ["eng-*"])));
});
