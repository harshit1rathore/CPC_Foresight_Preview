/* CPC Foresight dashboard. All text from data goes through textContent. */
"use strict";

const S = { index: null, data: null, h: null, cdMetric: "cd_top_share_4q", nb: {}, charts: {}, backtest: [] };
const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const TARGET_NAMES = {
  filing_share: "Filing share", disruption: "Highly disruptive share", pull: "Pull (citations received)",
  cite_share: "Citation share between pairs", coclass: "Co-classification strength", new_link: "New links (formation)",
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const pct = (x, d) => (x === null || x === undefined || !isFinite(x)) ? "–" : x === 0 ? "0%" :
  (x * 100).toFixed(d !== undefined ? d : (Math.abs(x) < 0.001 ? 3 : Math.abs(x) < 0.01 ? 2 : 1)) + "%";
const num = (x, d = 2) => (x === null || x === undefined || !isFinite(x)) ? "–" : Number(x).toFixed(d);
const signed = (x, f) => (x > 0 ? "+" : "") + f(x);
const compact = (x) => x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : x >= 1e4 ? (x / 1e3).toFixed(0) + "K" :
  x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : Math.round(x).toString();

// Static mode (exported site, no server): same page, data read from ./data/*.json and
// CPC input resolved in the browser. Set by <meta name="foresight-mode" content="static">.
const STATIC = document.querySelector('meta[name="foresight-mode"]')?.content === "static";
function staticUrl(url) {
  if (url === "/api/index") return "data/index.json";
  if (url === "/api/backtest") return "data/backtest.json";
  const m = url.match(/^\/api\/subclass\/([A-Z0-9]+)$/);
  if (m) return `data/subclass/${m[1]}.json`;
  return null;
}
async function getJSON(url) {
  if (STATIC) {
    if (url.startsWith("/api/resolve")) return resolveLocal(decodeURIComponent(url.split("q=")[1] || ""));
    const u = staticUrl(url);
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status === 404 ? "not in this export" : r.statusText);
    return r.json();
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
// Same rules as /api/resolve in app/main.py.
function resolveLocal(q) {
  const subs = S.index.subclasses, codes = new Map(subs.map((s) => [s.code, s]));
  const raw = q.trim().toUpperCase();
  const m = raw.match(/^([A-HY])\s*(\d{2})\s*([A-Z])\s*(\d{1,4})?\s*(?:\/\s*(\d{1,6}))?/);
  if (m) {
    const sub = m[1] + m[2] + m[3];
    const group = m[4] ? sub + m[4] + (m[5] ? "/" + m[5] : "") : null;
    if (codes.has(sub)) return { match: sub, group, candidates: [codes.get(sub)] };
    return { match: null, group, candidates: subs.filter((s) => s.code.startsWith(sub.slice(0, 3))).slice(0, 12),
      note: `${sub} has too few applications to be a graph node; showing its class.` };
  }
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = subs.map((s) => {
    const t = ((s.title || "") + " " + (s.class_title || "")).toLowerCase();
    return [words.filter((w) => t.includes(w)).length, s.n_apps || 0, s];
  }).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return { match: null, group: null, candidates: scored.slice(0, 12).map((x) => x[2]) };
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    S.index = await getJSON("/api/index");
  } catch (e) {
    $("empty").append(el("p", { class: "muted", text: "Could not load data: " + e.message }));
    return;
  }
  S.backtest = await getJSON("/api/backtest").catch(() => []);
  $("stamp").textContent = `Applications to ${S.index.as_of} · citations to ${S.index.citations_until} · built ${S.index.built_at}`;
  const pop = [...S.index.subclasses].sort((a, b) => b.n_apps - a.n_apps).slice(0, 14);
  for (const s of pop) $("popular").append(el("button", { class: "chip", onclick: () => go(s.code) }, s.code,
    el("span", { class: "w", text: (s.title || "").slice(0, 34) })));
  setupSearch();
  window.addEventListener("hashchange", fromHash);
  window.addEventListener("resize", () => Object.values(S.charts).forEach((c) => c && c.resize()));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => S.data && render());
  document.querySelectorAll(".tbl").forEach((b) => b.addEventListener("click", () => {
    const t = $(b.dataset.for + "-t"); t.hidden = !t.hidden; b.textContent = t.hidden ? "Table" : "Chart";
    $(b.dataset.for).style.display = t.hidden ? "" : "none";
  }));
  document.querySelectorAll("#cd-metric button").forEach((b) => b.addEventListener("click", () => {
    S.cdMetric = b.dataset.m;
    document.querySelectorAll("#cd-metric button").forEach((x) => x.classList.toggle("on", x === b));
    drawCDNeighbours();
  }));
  fromHash();
}

function fromHash() {
  const m = location.hash.match(/^#([A-HY]\d{2}[A-Z])(?:\|(.+))?$/i);
  if (m) load(m[1].toUpperCase(), m[2] ? decodeURIComponent(m[2]) : null);
}
function go(code, group) { location.hash = code + (group ? "|" + encodeURIComponent(group) : ""); }

// ------------------------------------------------------------------ search
function setupSearch() {
  const q = $("q"), list = $("suggest");
  let items = [], sel = -1;
  const show = (rows, note) => {
    list.replaceChildren(); items = rows; sel = -1;
    if (note) list.append(el("li", { class: "muted", text: note }));
    for (const s of rows) list.append(el("li", { onmousedown: (e) => { e.preventDefault(); pick(s); } },
      el("span", { class: "c", text: s.code }), el("span", { class: "t", text: s.title || "" })));
    list.hidden = rows.length === 0 && !note;
  };
  const pick = (s) => { list.hidden = true; q.value = s.code; go(s.code); };
  q.addEventListener("input", () => {
    const v = q.value.trim().toUpperCase();
    if (!v) return show([]);
    const words = v.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const rows = S.index.subclasses.filter((s) => s.code.startsWith(v.slice(0, 4)) ||
      (words.length && words.every((w) => ((s.title || "") + " " + (s.class_title || "")).toLowerCase().includes(w))))
      .sort((a, b) => b.n_apps - a.n_apps).slice(0, 10);
    show(rows);
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.classList.toggle("on", i === sel));
    } else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); pick(items[sel]); }
  });
  q.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  $("search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = q.value.trim();
    if (!v) return;
    const r = await getJSON("/api/resolve?q=" + encodeURIComponent(v)).catch(() => null);
    if (!r) return;
    if (r.match) { list.hidden = true; go(r.match, r.group); }
    else show(r.candidates, r.note || (r.candidates.length ? "Did you mean" : "No matching subclass"));
  });
}

// ------------------------------------------------------------------ load
async function load(code, group) {
  let d;
  try { d = await getJSON("/api/subclass/" + code); }
  catch (e) { alert("No data for " + code + ": " + e.message); return; }
  S.data = d; S.group = group; S.nb = {};
  const hs = Object.keys(d.threats).map(Number).sort((a, b) => a - b);
  if (!hs.includes(S.h)) S.h = hs.includes(4) ? 4 : hs[hs.length - 1];
  $("empty").hidden = true; $("view").hidden = false; $("filters").hidden = false;
  $("q").value = group || code;
  render();
  const nbs = d.neighbours.slice(0, 4).map((n) => n.code);
  await Promise.all(nbs.map(async (c) => { S.nb[c] = await getJSON("/api/subclass/" + c).catch(() => null); }));
  drawCDNeighbours();
}

function fcAt(target, h) { return (S.data.forecast[target] || []).find((r) => r.h === h); }
function monthsFromToday(qlabel) {
  const [y, q] = qlabel.split("Q").map(Number);
  const now = new Date();
  return ((y * 4 + q - 1) - (now.getFullYear() * 4 + Math.floor(now.getMonth() / 3))) * 3;
}
function todayQ() { const n = new Date(); return `${n.getFullYear()}Q${Math.floor(n.getMonth() / 3) + 1}`; }

function render() {
  const d = S.data;
  $("v-code").textContent = `${d.code} · section ${d.section} · ${d.class} ${d.class_title || ""}`;
  $("v-title").textContent = d.title;
  $("v-sub").textContent = `${compact(d.n_apps)} applications since 2001 · data as of ${d.as_of}, citations to ${d.citations_until}`;
  $("v-group").textContent = S.group && S.group !== d.code ?
    `You entered ${S.group}. Forecasts are made at subclass level (${d.code}); group-level detail is on the roadmap.` : "";
  renderHorizon(); renderTiles(); drawActivity(); drawCD(); drawCDNeighbours(); drawGraph();
  renderThreats(); renderOpps(); renderWhite(); renderKeywords(); renderAssignees(); renderPatents();
  renderAttention(); renderReliability();
}

function renderHorizon() {
  const box = $("horizon"); box.replaceChildren();
  const hs = Object.keys(S.data.threats).map(Number).sort((a, b) => a - b);
  for (const h of hs) {
    const f = fcAt("filing_share", h);
    const m = f ? monthsFromToday(f.quarter) : null;
    const lbl = f ? `${f.quarter} (${m >= 0 ? "+" : ""}${m} mo)` : `+${h}q`;
    box.append(el("button", { class: h === S.h ? "on" : "", role: "radio", "aria-checked": h === S.h,
      onclick: () => { S.h = h; render(); } }, lbl));
  }
  $("horizon-note").textContent = `Months counted from today (${todayQ()}). The data edge is ${S.data.as_of}; ` +
    `quarters between the data edge and today are themselves forecasts (nowcasts).`;
}

function tile(label, value, deltaNode) {
  return el("div", { class: "tile" }, el("div", { class: "label", text: label }),
    el("div", { class: "value", text: value }), deltaNode ? el("div", { class: "delta" }, deltaNode) : null);
}

function renderTiles() {
  const d = S.data, h = S.h, hist = d.history;
  const f = fcAt("filing_share", h), base = d.forecast.filing_share_base;
  const rel = f && base ? f.med / base - 1 : null;
  const dir = (x) => el("span", { class: x > 0 ? "up" : "dn", text: signed(x, (v) => pct(v)) });
  const t = $("tiles"); t.replaceChildren();
  const kc = hist.quarters.indexOf(hist.complete_until);
  const upto = (a) => a.slice(0, kc + 1);
  t.append(tile(`Share of US filings, 4 quarters to ${hist.complete_until}`, pct(lastVal(upto(hist.filing_share_4q)), 2),
    el("span", { text: `${compact(sumLast(upto(hist.filings), 4))} fractional applications; latest quarters still publishing` })));
  t.append(tile(`Forecast change in share by ${f ? f.quarter : ""}`, rel === null ? "–" : signed(rel, (v) => pct(v)),
    f && base ? el("span", {}, "80% range ", dir(f.lo / base - 1), " to ", dir(f.hi / base - 1)) : null));
  const fd = fcAt("disruption", h);
  const lastCD = lastVal(hist.cd_top_share_4q.slice(0, hist.quarters.indexOf(hist.cd_final_until) + 1));
  t.append(tile(`Highly disruptive share, ${fd ? fd.quarter : ""}`, fd ? pct(fd.med) : "–",
    el("span", { text: `last fully observed ${pct(lastCD)} (${hist.cd_final_until}); field average 10%` })));
  const ent = lastVal(upto(hist.entrant_ratio_4q));
  t.append(tile(`New entrants, 4 quarters to ${hist.complete_until}`, pct(ent, 0),
    el("span", { text: "of active applicants filed here for the first time" })));
}

const lastVal = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return a[i]; return null; };
const sumLast = (a, k) => a.slice(-k).reduce((s, x) => s + (x || 0), 0);

// ------------------------------------------------------------------ charts
function chart(id) {
  if (S.charts[id]) S.charts[id].dispose();
  S.charts[id] = echarts.init($(id), null, { renderer: "svg" });
  return S.charts[id];
}

function baseOpt() {
  return {
    animationDuration: 300, textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: css("--ink-2") },
    grid: { left: 56, right: 24, top: 28, bottom: 56 },
    tooltip: { trigger: "axis", backgroundColor: css("--surface"), borderColor: css("--border"),
      textStyle: { color: css("--ink"), fontSize: 12 }, axisPointer: { type: "line", lineStyle: { color: css("--axis") } } },
  };
}
function xAxis(cats) {
  return { type: "category", data: cats, boundaryGap: false, axisLine: { lineStyle: { color: css("--axis") } },
    axisTick: { show: false }, axisLabel: { color: css("--muted"), interval: (i, v) => v.endsWith("Q1") && (+v.slice(0, 4)) % 2 === 0, formatter: (v) => v.slice(0, 4) } };
}
function yAxis(fmt) {
  return { type: "value", splitLine: { lineStyle: { color: css("--grid") } }, axisLabel: { color: css("--muted"), formatter: fmt } };
}

function withForecast(hist, target, valuesKey) {
  const d = S.data;
  const q = [...hist.quarters];
  const fc = d.forecast[target] || [];
  for (const r of fc) if (!q.includes(r.quarter)) q.push(r.quarter);
  const pos = (k) => q.indexOf(k);
  const obs = q.map((_, i) => (i < hist.quarters.length ? hist[valuesKey][i] : null));
  const med = q.map(() => null), lo = q.map(() => null), band = q.map(() => null);
  for (const r of fc) { const i = pos(r.quarter); med[i] = r.med; lo[i] = r.lo; band[i] = Math.max(r.hi - r.lo, 0); }
  return { q, obs, med, lo, band };
}

function splitAt(arr, cats, untilLabel) {
  const k = cats.indexOf(untilLabel);
  const a = arr.map((v, i) => (k < 0 || i <= k ? v : null));
  const b = arr.map((v, i) => (k >= 0 && i >= k ? v : null));
  return [a, b];
}

function fanSeries(name, color, s) {
  return [
    { name: name + " low", type: "line", data: s.lo, stack: name, symbol: "none", lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
    { name: "80% interval", type: "line", data: s.band, stack: name, symbol: "none", lineStyle: { opacity: 0 },
      areaStyle: { color, opacity: 0.14 }, itemStyle: { color, opacity: 0.35 }, silent: true, tooltip: { show: false } },
    { name: "Forecast", type: "line", data: s.med, symbol: "circle", symbolSize: 8, connectNulls: true,
      lineStyle: { width: 2, type: [6, 4], color }, itemStyle: { color, borderColor: css("--surface"), borderWidth: 2 } },
  ];
}

function provisionalArea(cats, fromLabel, toLabel, text) {
  const a = cats.indexOf(fromLabel), b = cats.indexOf(toLabel);
  if (a < 0 || b < 0 || b <= a) return {};
  return { silent: true, itemStyle: { color: css("--wash"), opacity: 0.8 },
    label: { show: true, position: "insideTop", color: css("--muted"), fontSize: 11, formatter: text },
    data: [[{ xAxis: cats[a + 1] || cats[a] }, { xAxis: cats[b] }]] };
}

function drawActivity() {
  const d = S.data, h = d.history;
  const s = withForecast(h, "filing_share", "filing_share_4q");
  const [solid, prov] = splitAt(s.obs, s.q, h.complete_until);
  const c1 = css("--s1");
  const o = baseOpt();
  o.legend = { data: ["Observed", "Still filling in", "Forecast", "80% interval"], top: 0, right: 0, textStyle: { color: css("--ink-2"), fontSize: 12 } };
  o.xAxis = xAxis(s.q); o.yAxis = yAxis((v) => pct(v));
  o.tooltip.valueFormatter = (v) => pct(v, 3);
  o.dataZoom = [{ type: "slider", height: 18, bottom: 8, start: Math.max(0, 100 - (14 * 4 / s.q.length) * 100), end: 100,
    borderColor: css("--border"), fillerColor: "rgba(127,127,127,.12)", textStyle: { color: css("--muted") } }];
  o.series = [
    { name: "Observed", type: "line", data: solid, symbol: "none", lineStyle: { width: 2, color: c1 }, itemStyle: { color: c1 },
      markArea: provisionalArea(s.q, h.complete_until, d.as_of, "still filling in") },
    { name: "Still filling in", type: "line", data: prov, symbol: "none", lineStyle: { width: 2, color: c1, opacity: 0.45 }, itemStyle: { color: c1, opacity: 0.45 } },
    ...fanSeries("act", c1, s),
  ];
  chart("ch-activity").setOption(o);
  tableView("ch-activity-t", ["Quarter", "Observed", "Forecast", "Low", "High"],
    s.q.map((q, i) => [q, pct(s.obs[i], 3), pct(s.med[i], 3), s.lo[i] === null ? "–" : pct(s.lo[i], 3),
      s.lo[i] === null ? "–" : pct(s.lo[i] + s.band[i], 3)]).reverse());
}

function drawCD() {
  const d = S.data, h = d.history;
  const s = withForecast(h, "disruption", "cd_top_share_4q");
  const [solid, prov] = splitAt(s.obs, s.q, h.cd_final_until);
  const c = css("--s1");
  const o = baseOpt();
  o.legend = { data: ["Final (5-year window)", "Provisional", "Forecast"], top: 0, right: 0, textStyle: { color: css("--ink-2"), fontSize: 12 } };
  o.xAxis = xAxis(s.q); o.yAxis = yAxis((v) => pct(v, 0));
  o.tooltip.valueFormatter = (v) => pct(v);
  o.series = [
    { name: "Final (5-year window)", type: "line", data: solid, symbol: "none", lineStyle: { width: 2, color: c }, itemStyle: { color: c },
      markArea: provisionalArea(s.q, h.cd_final_until, d.as_of, "windows still open"),
      markLine: { silent: true, symbol: "none", lineStyle: { color: css("--axis"), type: "solid" },
        label: { color: css("--muted"), formatter: "cohort top 10%", fontSize: 11, position: "insideStartTop" }, data: [{ yAxis: 0.1 }] } },
    { name: "Provisional", type: "line", data: prov, symbol: "none", lineStyle: { width: 2, color: c, opacity: 0.45 }, itemStyle: { color: c, opacity: 0.45 } },
    ...fanSeries("cd", c, s),
  ];
  chart("ch-cd").setOption(o);
  tableView("ch-cd-t", ["Quarter", "Highly disruptive share", "Mean CD", "Patents scored", "Forecast"],
    s.q.map((q, i) => [q, pct(s.obs[i]), i < h.quarters.length ? num(h.cd_mean_4q[i], 3) : "–",
      i < h.quarters.length ? compact(h.cd_scored_4q[i] || 0) : "–", pct(s.med[i])]).reverse());
}

function drawCDNeighbours() {
  const d = S.data;
  if (!d) return;
  const key = S.cdMetric, h = d.history;
  const cols = ["--s1", "--s2", "--s3", "--s4", "--s5"].map(css);
  const subj = [{ code: d.code, title: d.title, hist: h }];
  for (const n of d.neighbours.slice(0, 4)) if (S.nb[n.code]) subj.push({ code: n.code, title: n.title, hist: S.nb[n.code].history });
  const o = baseOpt();
  o.legend = { data: subj.map((x) => x.code), top: 0, right: 0, textStyle: { color: css("--ink-2"), fontSize: 12 } };
  o.xAxis = xAxis(h.quarters);
  o.yAxis = yAxis(key === "cd_mean_4q" ? (v) => v.toFixed(2) : (v) => pct(v, 0));
  o.tooltip.valueFormatter = (v) => (key === "cd_mean_4q" ? num(v, 3) : pct(v));
  o.dataZoom = [{ type: "inside", start: Math.max(0, 100 - (16 * 4 / h.quarters.length) * 100), end: 100 }];
  o.series = subj.map((x, i) => ({
    name: x.code, type: "line", data: x.hist[key], symbol: "none", connectNulls: false,
    lineStyle: { width: i === 0 ? 2.5 : 2, color: cols[i] }, itemStyle: { color: cols[i] },
    markArea: i === 0 ? provisionalArea(h.quarters, h.cd_final_until, d.as_of, "provisional") : undefined,
  }));
  chart("ch-cdn").setOption(o);
  tableView("ch-cdn-t", ["Quarter", ...subj.map((x) => x.code)],
    h.quarters.map((q, i) => [q, ...subj.map((x) => key === "cd_mean_4q" ? num(x.hist[key][i], 3) : pct(x.hist[key][i]))]).reverse());
}

function drawGraph() {
  const d = S.data, hk = String(S.h);
  const sizeOf = (code) => {
    const s = S.index.subclasses.find((x) => x.code === code);
    return 14 + 5 * Math.log10(1 + (s ? s.n_apps : 100));
  };
  const roles = { self: css("--s1"), threat: css("--s2"), white: css("--s3"), neighbour: css("--neutral") };
  const nodes = new Map();
  const add = (code, title, role, info) => {
    const pr = { self: 3, threat: 2, white: 1, neighbour: 0 };
    if (nodes.has(code) && pr[nodes.get(code).role] >= pr[role]) return;
    nodes.set(code, { code, title, role, info });
  };
  add(d.code, d.title, "self", "this subclass");
  d.neighbours.forEach((n) => add(n.code, n.title, "neighbour", `proximity ${num(n.proximity)}`));
  (d.threats[hk] || []).slice(0, 6).forEach((t) => add(t.code, t.title, "threat", `threat score ${num(t.score, 3)}`));
  (d.white_spaces || []).slice(0, 6).forEach((w) => add(w.code, w.title, "white", `P(new link) ${pct(w.p_link, 0)}`));
  const links = [];
  for (const n of nodes.values()) {
    if (n.role === "self") continue;
    const nb = d.neighbours.find((x) => x.code === n.code);
    links.push({ source: d.code, target: n.code,
      lineStyle: { width: nb ? 1 + 3 * Math.min(nb.proximity / 2, 1) : 1, type: n.role === "white" ? [4, 4] : "solid",
        color: css("--axis"), opacity: 0.9 } });
  }
  const o = { animationDuration: 300, tooltip: { backgroundColor: css("--surface"), borderColor: css("--border"),
      textStyle: { color: css("--ink"), fontSize: 12 },
      formatter: (p) => p.dataType === "node" ? `<b>${esc(p.data.code)}</b> ${esc(p.data.title || "")}<br>${esc(p.data.info)}` : "" },
    series: [{ type: "graph", layout: "force", roam: true, draggable: true, force: { repulsion: 260, edgeLength: [80, 170], gravity: 0.08 },
      label: { show: true, position: "right", color: css("--ink"), fontSize: 12, formatter: (p) => p.data.code },
      data: [...nodes.values()].map((n) => ({ name: n.code, code: n.code, title: n.title, info: n.info,
        symbolSize: n.role === "self" ? 34 : sizeOf(n.code), itemStyle: { color: roles[n.role], borderColor: css("--surface"), borderWidth: 2 } })),
      links }] };
  const c = chart("ch-graph");
  c.setOption(o);
  c.on("click", (p) => { if (p.dataType === "node" && p.data.code !== d.code) go(p.data.code); });
  const lg = $("graph-legend"); lg.replaceChildren();
  for (const [k, lab] of [["self", "This subclass"], ["neighbour", "Neighbour"], ["threat", "Threat"], ["white", "White space"]])
    lg.append(el("span", {}, el("span", { class: "k", style: `background:${roles[k]}` }), lab));
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ------------------------------------------------------------------ tables
function tableView(id, head, rows) {
  const t = el("table", {}, el("thead", {}, el("tr", {}, ...head.map((h, i) => el("th", { class: i ? "num" : "", text: h })))));
  const tb = el("tbody");
  for (const r of rows) tb.append(el("tr", {}, ...r.map((v, i) => el("td", { class: i ? "num" : "", text: v }))));
  t.append(tb);
  $(id).replaceChildren(t);
}

function codeCell(code, title) {
  return el("td", {}, el("a", { class: "link", href: "#" + code, text: code }), " ", el("span", { class: "t2", text: title || "" }));
}
function barCell(v, max, cls = "") {
  const w = max > 0 ? Math.max(2, Math.round(60 * v / max)) : 2;
  return el("td", { class: "num" }, el("span", { class: "bar " + cls, style: `width:${w}px` }), num(v, 3));
}
function simpleTable(head, rows, emptyText) {
  if (!rows.length) return el("p", { class: "muted", text: emptyText || "Nothing stands out at this horizon." });
  const t = el("table", {}, el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { class: h.num ? "num" : "", text: h.t })))));
  const tb = el("tbody"); rows.forEach((r) => tb.append(el("tr", {}, ...r))); t.append(tb);
  return t;
}

function renderThreats() {
  const rows = S.data.threats[String(S.h)] || [];
  const max = Math.max(...rows.map((r) => r.score), 0);
  $("threats").replaceChildren(simpleTable(
    [{ t: "Subclass" }, { t: "Score", num: 1 }, { t: "Substitution", num: 1 }, { t: "Growth gap", num: 1 }, { t: "In fields" }],
    rows.map((r) => [codeCell(r.code, r.title), barCell(r.score, max), el("td", { class: "num", text: num(r.substitution, 3) }),
      el("td", { class: "num", text: r.growth_gap === null ? "–" : signed(r.growth_gap, (v) => num(v, 2)) }),
      el("td", { class: "t2", text: (r.via || []).join(", ") || "–" })]),
    "No field is forecast to displace this subclass at this horizon."));
}

function renderOpps() {
  const o = S.data.opportunities[String(S.h)] || { pull: [], convergence: [] };
  const box = $("opps"); box.replaceChildren();
  box.append(el("div", { class: "subhead", text: "Pull" }));
  const mp = Math.max(...o.pull.map((r) => r.score), 0);
  box.append(simpleTable([{ t: "Field citing you" }, { t: "Score", num: 1 }, { t: "Share now → forecast", num: 1 }],
    o.pull.map((r) => [codeCell(r.code, r.title), barCell(r.score, mp, "s3"),
      el("td", { class: "num", text: `${pct(r.share_now)} → ${pct(r.share_forecast)}` })]), "No rising pull at this horizon."));
  box.append(el("div", { class: "subhead", text: "Convergence" }));
  box.append(simpleTable([{ t: "Subclass" }, { t: "Link strength now → forecast", num: 1 }],
    o.convergence.map((r) => [codeCell(r.code, r.title), el("td", { class: "num", text: `${num(r.ppmi_now)} → ${num(r.ppmi_forecast)}` })]),
    "No strengthening links at this horizon."));
}

function renderWhite() {
  const rows = S.data.white_spaces || [];
  const mx = Math.max(...rows.map((r) => r.p_link), 0);
  $("whitespace").replaceChildren(simpleTable(
    [{ t: "Subclass" }, { t: "P(new link)", num: 1 }, { t: "Closeness", num: 1 }, { t: "By", num: 1 }],
    rows.map((r) => [codeCell(r.code, r.title), barCell(r.p_link, mx, "s3"),
      el("td", { class: "num", text: r.similarity_kind === "semantic" && r.similarity_rank !== null
        ? `top ${Math.max(1, Math.round((1 - r.similarity_rank) * 100))}% by text` : `${num(r.similarity)} structural` }),
      el("td", { class: "num", text: `+${r.h}q` })]), "No white spaces forecast."));
}

function renderKeywords() {
  const d = S.data, box = $("keywords"); box.replaceChildren();
  box.append(el("div", { class: "subhead", text: "Distinctive now" }));
  const c1 = el("div", { class: "chips", style: "justify-content:flex-start" });
  d.keywords.forEach((k) => c1.append(el("span", { class: "chip static", text: k.term })));
  box.append(d.keywords.length ? c1 : el("p", { class: "muted", text: "No keywords." }));
  box.append(el("div", { class: "subhead", text: "Rising fastest" }));
  const c2 = el("div", { class: "chips", style: "justify-content:flex-start" });
  d.emerging_terms.forEach((k) => c2.append(el("span", { class: "chip static" }, k.term,
    el("span", { class: "w", text: "×" + Math.exp(k.growth).toFixed(1) }))));
  box.append(d.emerging_terms.length ? c2 : el("p", { class: "muted", text: "No rising terms." }));
}

function renderAssignees() {
  const d = S.data, box = $("assignees"); box.replaceChildren();
  const g = (x) => x === null ? "–" : "×" + Math.exp(x).toFixed(1);
  box.append(el("div", { class: "subhead", text: "Largest" }));
  box.append(simpleTable([{ t: "Applicant" }, { t: "Filings", num: 1 }, { t: "vs prior 8q", num: 1 }],
    d.top_assignees.map((a) => [el("td", { text: a.name }), el("td", { class: "num", text: num(a.recent, 1) }), el("td", { class: "num", text: g(a.growth) })])));
  box.append(el("div", { class: "subhead", text: "Rising" }));
  box.append(simpleTable([{ t: "Applicant" }, { t: "Filings", num: 1 }, { t: "vs prior 8q", num: 1 }],
    d.rising_assignees.map((a) => [el("td", { text: a.name }), el("td", { class: "num", text: num(a.recent, 1) }), el("td", { class: "num", text: g(a.growth) })])));
}

function renderPatents() {
  const rows = S.data.notable_patents || [];
  $("patents").replaceChildren(simpleTable([{ t: "Patent" }, { t: "Granted", num: 1 }, { t: "CD", num: 1 }, { t: "Citing", num: 1 }],
    rows.map((p) => [el("td", {}, el("a", { class: "link", href: `https://patents.google.com/patent/US${p.patent}`, target: "_blank", rel: "noopener", text: p.patent }),
      " ", el("span", { class: "t2", text: (p.title || "").toLowerCase() })),
      el("td", { class: "num", text: String(p.granted).slice(0, 10) }), el("td", { class: "num", text: num(p.cd, 2) }),
      el("td", { class: "num", text: p.forward })]), "CD index not computed yet (run 03_compute_cd.py)."));
}

function renderAttention() {
  const rel = { builds_on: "builds on", built_on_by: "is built on by", coclass: "co-classified with", semantic: "reads like" };
  const rows = S.data.model_attention || [];
  $("attention").replaceChildren(simpleTable([{ t: "Relation" }, { t: "Subclass" }, { t: "Weight", num: 1 }],
    rows.map((r) => [el("td", { class: "t2", text: rel[r.relation] || r.relation }), codeCell(r.code, r.title),
      el("td", { class: "num", text: num(r.weight, 2) })])));
}

function renderReliability() {
  const rows = (S.backtest || []).filter((r) => Number(r.h) === S.h);
  const box = $("reliability");
  if (!rows.length) { box.replaceChildren(el("p", { class: "muted", text: "Backtest not run (05_train_gnn.py without --skip-backtest)." })); return; }
  const node = rows.filter((r) => r.kind === "node"), edge = rows.filter((r) => r.kind === "edge"),
    fm = rows.filter((r) => r.kind === "formation");
  const sk = (x) => x === null || x === undefined ? "–" : signed(x, (v) => pct(v, 0));
  const cov = (r) => pct(r.coverage80_calibrated ?? r.coverage80, 0);
  const mix = (w) => w === null || w === undefined ? "GNN" : w >= 0.95 ? "GNN" : w <= 0.05 ? "trees" :
    `${Math.round(w * 100)}% GNN`;
  box.replaceChildren(simpleTable(
    [{ t: "Forecast" }, { t: "vs no change", num: 1 }, { t: "vs plain GBM", num: 1 }, { t: "80% band covers", num: 1 }, { t: "Model", num: 1 }],
    [...node.map((r) => [el("td", { text: TARGET_NAMES[r.target] || r.target }), el("td", { class: "num", text: sk(r.skill_vs_persistence) }),
        el("td", { class: "num", text: sk(r.skill_vs_gbm) }), el("td", { class: "num", text: cov(r) }),
        el("td", { class: "num", text: mix(r.w_gnn_final ?? r.w_gnn) })]),
     ...edge.map((r) => [el("td", { text: TARGET_NAMES[r.target] || r.target }), el("td", { class: "num", text: sk(r.skill_vs_persistence) }),
        el("td", { class: "num", text: "–" }), el("td", { class: "num", text: pct(r.coverage80, 0) }), el("td", { class: "num", text: "GNN" })])]));
  for (const f of fm) box.append(el("p", { class: "desc", style: "margin-top:8px",
    text: `New-link forecasts (GNN): AUC ${num(f.auc)} (simple co-classification heuristic ${num(f.auc_heuristic)}), ` +
      `average precision ${num(f.ap)} vs ${num(f.ap_heuristic)}, base rate ${pct(f.base_rate)}.` }));
}

boot();
