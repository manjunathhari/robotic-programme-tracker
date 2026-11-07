/* Robotic Programme Tracker — single-page app (no build step).
 * Data model (Supabase, all rp_* tables, RLS-protected):
 *   rp_hospital_month   month, total_cases          — every robotic case in the hospital
 *   rp_department_month month, department_code, cases — GI (Gastro Surgery total)
 *   rp_surgeon_month    month, surgeon_id, package (R1/R2/R3), cases
 * Everything else (quarters, FYs, shares, growth, complexity) is derived here.
 */
(() => {
const C = window.RP_CONFIG;
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
const DETAIL_FROM = "2026-04-01"; // first month with department / surgeon / R-package detail
const PKGS = ["R1", "R2", "R3"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_MONTHS = [4,5,6,7,8,9,10,11,12,1,2,3];

const S = { user: null, role: null, surgeons: [], depts: [], recs: new Map(), keys: [], charts: {}, tab: "dashboard" };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const key = (y, m) => `${y}-${pad(m)}-01`;
const ym = (k) => ({ y: +k.slice(0, 4), m: +k.slice(5, 7) });
const fyOf = (y, m) => (m >= 4 ? y : y - 1);
const fyLabel = (fs) => `FY ${fs}-${pad((fs + 1) % 100)}`;
const fqOf = (m) => Math.floor(((m + 8) % 12) / 3) + 1;
const QNAME = { 1: "Q1 Apr–Jun", 2: "Q2 Jul–Sep", 3: "Q3 Oct–Dec", 4: "Q4 Jan–Mar" };
const mLabel = (k) => { const { y, m } = ym(k); return `${MON[m - 1]} ${String(y).slice(2)}`; };
const mLong = (k) => { const { y, m } = ym(k); return `${MON[m - 1]} ${y}`; };
const addM = (k, n) => { const { y, m } = ym(k); const t = y * 12 + (m - 1) + n; return key(Math.floor(t / 12), (t % 12) + 1); };
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (v, d = 0) => (v == null || !isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`);
const sgn = (v, d = 0) => (v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const cls = (v) => (v == null || !isFinite(v) ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (msg) => { const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 2600); };
const lastCompleteMonth = () => { const d = new Date(); return addM(key(d.getFullYear(), d.getMonth() + 1), -1); };

/* ---------------- metrics on a month record ---------------- */
const emptyRec = (k) => ({ key: k, ...ym(k), hosp: null, notes: null, gs: null, giEntered: null, surg: {} });
const cell = (r, sid, p) => r.surg[sid]?.[p] ?? null;
const sumN = (arr) => { let s = null; for (const v of arr) if (v != null) s = (s ?? 0) + v; return s; };
const M = {
  hosp: (r) => r.hosp,
  gi: (r) => r.giEntered ?? M.giGrid(r),
  giGrid: (r) => sumN(Object.values(r.surg).flatMap((o) => PKGS.map((p) => o[p] ?? null))),
  other: (r) => (r.hosp == null ? null : r.hosp - (M.gi(r) || 0)),
  surgeon: (sid) => (r) => sumN(PKGS.map((p) => cell(r, sid, p))),
  pkg: (p, sid = null) => (r) => (sid ? cell(r, sid, p) : sumN(Object.keys(r.surg).map((s) => cell(r, s, p)))),
};
const agg = (recs, fn) => sumN(recs.map(fn));
const complexity = (recs, sid = null) => {
  const [a, b, c] = PKGS.map((p) => agg(recs, M.pkg(p, sid)) || 0);
  const n = a + b + c;
  return { r1: a, r2: b, r3: c, n, ci: n ? (a + 2 * b + 3 * c) / n : null, hi: n ? (b + c) / n : null };
};

/* ---------------- periods ---------------- */
function periods(gran, keys) {
  const out = []; const idx = new Map();
  for (const k of keys) {
    const { y, m } = ym(k); const fs = fyOf(y, m); const q = fqOf(m);
    const id = gran === "month" ? k : gran === "quarter" ? `${fs}Q${q}` : `${fs}`;
    if (!idx.has(id)) {
      const label = gran === "month" ? mLabel(k) : gran === "quarter" ? `${fyLabel(fs).replace("FY ", "FY")} Q${q}` : fyLabel(fs);
      const p = { id, label, fs, q, keys: [], recs: [] }; idx.set(id, p); out.push(p);
    }
    const p = idx.get(id); p.keys.push(k); p.recs.push(S.recs.get(k) || emptyRec(k));
  }
  for (const p of out) p.expected = gran === "month" ? 1 : gran === "quarter" ? 3 : 12;
  return out;
}
// Like-for-like YoY: compare only the months that have data in this period with the same months a year earlier.
function yoy(p, fn) {
  let cur = 0, prev = 0, used = 0;
  for (const r of p.recs) {
    const v = fn(r); if (v == null) continue;
    const pr = S.recs.get(addM(r.key, -12)); const pv = pr ? fn(pr) : null;
    if (pv == null) continue;
    cur += v; prev += pv; used++;
  }
  return used && prev ? { g: cur / prev - 1, used, cur, prev } : null;
}
const isPartial = (p, fn) => p.recs.filter((r) => fn(r) != null).length < p.expected;

/* ---------------- data load ---------------- */
async function loadAll() {
  const [sg, dp, hm, dm, sm] = await Promise.all([
    sb.from("rp_surgeons").select("*").order("sort"),
    sb.from("rp_departments").select("*").order("sort"),
    sb.from("rp_hospital_month").select("*"),
    sb.from("rp_department_month").select("*"),
    sb.from("rp_surgeon_month").select("*"),
  ]);
  for (const r of [sg, dp, hm, dm, sm]) if (r.error) throw r.error;
  S.surgeons = sg.data; S.depts = dp.data; S.recs = new Map();
  const get = (k) => { if (!S.recs.has(k)) S.recs.set(k, emptyRec(k)); return S.recs.get(k); };
  for (const r of hm.data) { const x = get(r.month); x.hosp = r.total_cases; x.notes = r.notes; }
  for (const r of dm.data) { const x = get(r.month); if (r.department_code === "GI") x.giEntered = r.cases; }
  for (const r of sm.data) { const x = get(r.month); (x.surg[r.surgeon_id] ||= {}); x.surg[r.surgeon_id][r.package] = (x.surg[r.surgeon_id][r.package] || 0) + r.cases; }
  // contiguous month list from first data month to last complete month
  const ks = [...S.recs.keys()].sort();
  const first = ks[0] || DETAIL_FROM; let last = ks[ks.length - 1] || first;
  if (lastCompleteMonth() > last) last = lastCompleteMonth();
  S.keys = []; for (let k = first; k <= last; k = addM(k, 1)) S.keys.push(k);
  const withData = ks.filter((k) => S.recs.get(k).hosp != null);
  $("data-status").textContent = withData.length ? `Data through ${mLong(withData[withData.length - 1])}` : "";
  buildFilters();
}

function buildFilters() {
  const fys = [...new Set(S.keys.map((k) => { const { y, m } = ym(k); return fyOf(y, m); }))];
  const keep = (sel, def) => { const v = sel.value; sel.innerHTML = fys.map((f) => `<option value="${f}">${fyLabel(f)}</option>`).join(""); sel.value = v && fys.includes(+v) ? v : def; };
  keep($("f-from"), fys[0]); keep($("f-to"), fys[fys.length - 1]);
  if (!S.toPinned) $("f-to").value = fys[fys.length - 1];
}
function rangeKeys() {
  let a = +$("f-from").value, b = +$("f-to").value; if (a > b) [a, b] = [b, a];
  return S.keys.filter((k) => { const { y, m } = ym(k); const f = fyOf(y, m); return f >= a && f <= b; });
}
const gran = () => $("f-gran").value;
const giSurgeons = () => S.surgeons.filter((s) => s.department_code === "GI");
const SCOL = (i) => css(`--s${(i % 5) + 1}`);
// FY overlay: current (last) year in ink, older years in a grey ramp, oldest lightest
const fyColor = (i) => css(`--y${(i % 5) + 1}`);

/* ---------------- charts ---------------- */
function chart(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  const ink2 = css("--ink-2"), grid = css("--grid");
  Chart.defaults.font.family = 'Geist, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = ink2;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, transitions: { resize: { animation: { duration: 0 } } },
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: { backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink"), borderColor: css("--axis"), borderWidth: 1, padding: 10 } },
    scales: { x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { precision: 0 } } },
  };
  cfg.options = deepMerge(base, cfg.options || {});
  S.charts[id] = new Chart($(id), cfg);
}
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
const barDs = (label, data, color, stack) => ({ label, data, backgroundColor: color, borderColor: css("--surface"), borderWidth: stack ? { top: 2 } : 0, borderRadius: stack ? 0 : 4, borderSkipped: "start", maxBarThickness: 46, stack });
const lineDs = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, cubicInterpolationMode: "monotone", tension: 0.3, spanGaps: false });

/* ---------------- DASHBOARD ---------------- */
function renderDashboard() {
  const withH = S.keys.filter((k) => S.recs.get(k)?.hosp != null);
  const kpis = $("kpis");
  if (!withH.length) { kpis.innerHTML = '<div class="muted">No data yet.</div>'; return; }
  const lastK = withH[withH.length - 1]; const { y, m } = ym(lastK); const fs = fyOf(y, m);
  const fyRecs = S.keys.filter((k) => { const t = ym(k); return fyOf(t.y, t.m) === fs && k <= lastK; }).map((k) => S.recs.get(k) || emptyRec(k));
  const fytd = agg(fyRecs, M.hosp); const n = fyRecs.filter((r) => r.hosp != null).length;
  const lfl = yoy({ recs: fyRecs }, M.hosp);
  const roll = (end) => { const ks = []; for (let i = 0; i < 12; i++) ks.push(addM(end, -i)); const rs = ks.map((k) => S.recs.get(k)).filter(Boolean); return rs.filter((r) => r.hosp != null).length === 12 ? agg(rs, M.hosp) : null; };
  const r12 = roll(lastK), r12p = roll(addM(lastK, -12));
  const giR = fyRecs.filter((r) => r.hosp != null && M.gi(r) != null);
  const giT = agg(giR, M.gi), hT = agg(giR, M.hosp);
  const cx = complexity(fyRecs);
  const T = trajectory("Hospital", M.hosp);
  const tile = (lab, val, ctx) => `<div class="kpi"><div class="lab">${lab}</div><div class="val">${val}</div><div class="ctx">${ctx}</div></div>`;
  kpis.innerHTML = [
    tile(`${fyLabel(fs)} to date`, fmt(fytd), `${lfl ? `<span class="${cls(lfl.g)}">${sgn(lfl.g)}</span> vs same months last FY (${fmt(lfl.prev)}) · ` : ""}through ${mLong(lastK)}`),
    tile("Rolling 12 months", fmt(r12), r12p ? `<span class="${cls(r12 / r12p - 1)}">${sgn(r12 / r12p - 1)}</span> vs previous 12` : "–"),
    ...(T ? [
      tile(`${fyLabel(fs)} projected total`, fmt(T.projTotal), `${T.projGrowth != null ? `<span class="${cls(T.projGrowth)}">${sgn(T.projGrowth)}</span> vs ${fyLabel(fs - 1)} (${fmt(T.lastFY)}) · ` : ""}at this year's pace`),
      tile(`Expected total (last year's ${sgn(T.gE)})`, fmt(T.expTotal), `To date ${fmt(T.actFYTD)} vs ${fmt(T.expToDate)} expected · <span class="${cls(T.gap)}">${sgn(T.gap)}</span>`),
    ] : []),
    tile("Gastro share (FYTD)", pct(hT ? giT / hT : null), `${fmt(giT)} of ${fmt(hT)} hospital cases`),
    tile("Gastro complexity index (FYTD)", fmt(cx.ci, 2), `R2+R3 = ${pct(cx.hi)} · ${fmt(cx.r1)}/${fmt(cx.r2)}/${fmt(cx.r3)}`),
  ].join("");

  const ps = periods(gran(), rangeKeys());
  chart("c-total", { type: "bar", data: { labels: ps.map((p) => p.label + (isPartial(p, M.hosp) && agg(p.recs, M.hosp) != null ? "*" : "")),
    datasets: [barDs("Robotic cases", ps.map((p) => agg(p.recs, M.hosp)), css("--data-1"))] },
    options: { plugins: { legend: { display: false } } } });

  const fys = [...new Set(rangeKeys().map((k) => { const t = ym(k); return fyOf(t.y, t.m); }))].slice(-5);
  chart("c-overlay", { type: "line", data: { labels: FY_MONTHS.map((mm) => MON[mm - 1]),
    datasets: [...fys.map((f, i) => lineDs(fyLabel(f), FY_MONTHS.map((mm) => S.recs.get(key(mm >= 4 ? f : f + 1, mm))?.hosp ?? null), fyColor(i, fys.length))),
      ...(T && fys.includes(T.fs) ? trajDatasets(T, fyColor(fys.indexOf(T.fs), fys.length), false).slice(1).map((d) => ({ ...d, label: d.label.replace("Projected", `${fyLabel(T.fs)} projected`) })) : [])] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? "–" : fmt(c.raw, Number.isInteger(c.raw) ? 0 : 1)}` } } } } });

  // pending entries
  const pend = [];
  for (const k of S.keys) {
    if (k < DETAIL_FROM || k > lastCompleteMonth()) continue;
    const r = S.recs.get(k) || emptyRec(k); const miss = [];
    if (r.hosp == null) miss.push("hospital total");
    if (M.giGrid(r) == null) miss.push("surgeon grid");
    if (miss.length) pend.push({ k, miss });
  }
  $("pending").innerHTML = pend.length
    ? `<div class="pending">${pend.map((x) => `<button class="chip" data-month="${x.k}" title="Missing: ${x.miss.join(", ")}">${mLong(x.k)} · ${x.miss.join(", ")}</button>`).join("")}</div>`
    : '<span class="muted">All months up to date.</span>';
  $("pending").querySelectorAll("[data-month]").forEach((b) => b.onclick = () => { if (canEdit()) { switchTab("entry"); openMonth(b.dataset.month); } });
}

/* ---------------- CONTRIBUTION ---------------- */
function renderContribution() {
  const ps = periods(gran(), rangeKeys());
  chart("c-dept", { type: "bar", data: { labels: ps.map((p) => p.label), datasets: [
    barDs("Gastro", ps.map((p) => agg(p.recs, M.gi)), css("--d-gi"), "d"),
    barDs("Other specialties", ps.map((p) => agg(p.recs, M.other)), css("--d-other"), "d"),
  ] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } });

  const gp = ps.filter((p) => agg(p.recs, M.giGrid) != null);
  const sgs = giSurgeons();
  chart("c-surg", { type: "bar", data: { labels: gp.map((p) => p.label), datasets: sgs.map((s, i) => barDs(s.name, gp.map((p) => agg(p.recs, M.surgeon(s.id))), SCOL(i), "s")) },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } } });

  const head = `<tr><th>Period</th><th>Hospital</th><th>Gastro</th><th>% hosp</th>${sgs.map((s) => `<th>${esc(s.name)}</th><th>% gastro</th><th>% hosp</th>`).join("")}</tr>`;
  const rows = ps.filter((p) => agg(p.recs, M.gi) != null).map((p) => {
    const h = agg(p.recs, M.hosp), g = agg(p.recs, M.gi);
    return `<tr><td>${p.label}</td><td>${fmt(h)}</td><td>${fmt(g)}</td><td>${pct(h && g != null ? g / h : null)}</td>${sgs.map((s) => { const v = agg(p.recs, M.surgeon(s.id)); return `<td>${fmt(v)}</td><td>${pct(g && v != null ? v / g : null)}</td><td>${pct(h && v != null ? v / h : null)}</td>`; }).join("")}</tr>`;
  });
  $("t-share").innerHTML = `<table>${head}${rows.join("")}</table>`;
}


/* ---------------- SURGEONS (head-to-head) ---------------- */
function surgeonStats(s, recs) {
  const fn = M.surgeon(s.id);
  const withD = recs.filter((r) => fn(r) != null);
  const n = agg(withD, fn) || 0;
  const giTot = agg(withD, M.gi) || 0;
  const hBoth = withD.filter((r) => r.hosp != null);
  const hTot = agg(hBoth, M.hosp) || 0, nH = agg(hBoth, fn) || 0;
  const cx = complexity(recs, s.id), all = complexity(recs);
  let best = null; for (const r of withD) if (!best || fn(r) > fn(best)) best = r;
  const last3 = withD.slice(-3), prev3 = withD.slice(-6, -3);
  const l3 = agg(last3, fn), p3 = prev3.length === 3 ? agg(prev3, fn) : null;
  return { s, n, months: withD.length, avg: withD.length ? n / withD.length : null,
    shareGi: giTot ? n / giTot : null, shareHosp: hTot ? nH / hTot : null,
    ...cx, shareR1: all.r1 ? cx.r1 / all.r1 : null, shareR2: all.r2 ? cx.r2 / all.r2 : null, shareR3: all.r3 ? cx.r3 / all.r3 : null,
    best, bestN: best ? fn(best) : null, mom: l3 != null && p3 ? l3 / p3 - 1 : null, l3, p3,
    yoy: yoy({ recs: withD }, fn) };
}
function renderSurgeons() {
  const keys = rangeKeys(); const recs = keys.map((k) => S.recs.get(k) || emptyRec(k));
  const sgs = giSurgeons(); const st = sgs.map((s) => surgeonStats(s, recs));
  const dataRecs = recs.filter((r) => M.giGrid(r) != null);
  $("sg-range").textContent = dataRecs.length ? `· ${mLong(dataRecs[0].key)} – ${mLong(dataRecs[dataRecs.length - 1].key)}` : "";

  $("sg-cards").innerHTML = st.map((x, i) => {
    const tot = x.r1 + x.r2 + x.r3 || 1;
    return `<div class="sg-card" style="--c:${SCOL(i)}"><div class="nm">${esc(x.s.name)}</div>
      <div class="big">${fmt(x.n)}</div><div class="muted small">cases · ${x.months} month${x.months === 1 ? "" : "s"}</div>
      <div class="mixbar" title="R1 ${x.r1} · R2 ${x.r2} · R3 ${x.r3}">${PKGS.map((p, j) => `<i style="width:${(x[p.toLowerCase()] / tot) * 100}%;background:var(--r${j + 1})"></i>`).join("")}</div>
      <div class="muted small" style="margin-top:4px">R1 ${x.r1} · R2 ${x.r2} · R3 ${x.r3}</div>
      <div class="meta">
        <div><b>${pct(x.shareGi)}</b><span>of gastro</span></div>
        <div><b>${pct(x.shareHosp)}</b><span>of hospital</span></div>
        <div><b>${fmt(x.avg, 1)}</b><span>avg / month</span></div>
        <div><b>${fmt(x.ci, 2)}</b><span>complexity index</span></div>
        <div><b>${pct(x.hi)}</b><span>R2 + R3</span></div>
        <div><b class="${cls(x.mom)}">${sgn(x.mom)}</b><span>last 3 vs prior 3 mo</span></div>
      </div></div>`;
  }).join("");

  const ps = periods(gran(), keys).filter((p) => agg(p.recs, M.giGrid) != null);
  chart("c-sg-cases", { type: "bar", data: { labels: ps.map((p) => p.label),
    datasets: sgs.map((s, i) => ({ ...barDs(s.name, ps.map((p) => agg(p.recs, M.surgeon(s.id))), SCOL(i)), maxBarThickness: 22 })) } });

  const mk = keys.filter((k) => M.giGrid(S.recs.get(k) || emptyRec(k)) != null);
  chart("c-sg-cum", { type: "line", data: { labels: mk.map(mLabel), datasets: sgs.map((s, i) => {
    let c = 0; return lineDs(s.name, mk.map((k) => (c += M.surgeon(s.id)(S.recs.get(k)) || 0)), SCOL(i)); }) } });

  chart("c-sg-share", { type: "line", data: { labels: ps.map((p) => p.label), datasets: sgs.map((s, i) => lineDs(s.name, ps.map((p) => {
      const g = agg(p.recs, M.giGrid), v = agg(p.recs, M.surgeon(s.id)); return g ? +(v / g * 100).toFixed(1) : null; }), SCOL(i))) },
    options: { scales: { y: { max: 100, ticks: { callback: (v) => v + "%" } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw}%` } } } } });

  chart("c-sg-pkg", { type: "bar", data: { labels: sgs.map((s) => s.name),
    datasets: PKGS.map((p, j) => barDs(p, st.map((x) => x[p.toLowerCase()]), css(`--r${j + 1}`), "p")) },
    options: { interaction: { mode: "index" }, scales: { x: { stacked: true }, y: { stacked: true } } } });

  const rows = [
    ["Total robotic cases", (x) => x.n, 0], ["Months with data", (x) => x.months, 0, true], ["Average cases / month", (x) => x.avg, 1],
    ["Best month", (x) => x.bestN, 0, false, (x) => (x.best ? `${x.bestN} (${mLabel(x.best.key)})` : "–")],
    ["Share of gastro", (x) => x.shareGi, "%"], ["Share of hospital robotic", (x) => x.shareHosp, "%"],
    ["R1 cases", (x) => x.r1, 0], ["R2 cases", (x) => x.r2, 0], ["R3 cases", (x) => x.r3, 0],
    ["% of all gastro R1", (x) => x.shareR1, "%"], ["% of all gastro R2", (x) => x.shareR2, "%"], ["% of all gastro R3", (x) => x.shareR3, "%"],
    ["R2 + R3 share of own cases", (x) => x.hi, "%"], ["Complexity index", (x) => x.ci, 2],
    ["Last 3 vs prior 3 months", (x) => x.mom, "±"], ["YoY (same months last year)", (x) => x.yoy?.g ?? null, "±"],
  ];
  const f = (v, d) => (d === "%" ? pct(v) : d === "±" ? sgn(v) : fmt(v, d));
  $("t-sg").innerHTML = `<table><tr><th>Measure</th>${sgs.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th>All gastro</th></tr>${rows.map(([lab, fn, d, noBest, txt]) => {
    const vals = st.map(fn); const mx = Math.max(...vals.filter((v) => v != null && isFinite(v)));
    const tot = lab === "Total robotic cases" ? fmt(complexity(recs).n) : /^R\d cases$/.test(lab) ? fmt(complexity(recs)[lab.slice(0, 2).toLowerCase()]) : lab === "Complexity index" ? fmt(complexity(recs).ci, 2) : lab === "R2 + R3 share of own cases" ? pct(complexity(recs).hi) : "";
    return `<tr><td>${lab}</td>${st.map((x, i) => { const v = vals[i]; const top = !noBest && d !== "±" && v != null && v === mx && st.length > 1 && v !== 0;
      return `<td class="${top ? "best" : ""} ${d === "±" ? cls(v) : ""}">${txt ? txt(x) : f(v, d)}${top ? " ▲" : ""}</td>`; }).join("")}<td class="muted">${tot}</td></tr>`;
  }).join("")}</table>`;
}

/* ---------------- COMPLEXITY ---------------- */
function renderComplexity() {
  const ps = periods(gran(), rangeKeys()).filter((p) => agg(p.recs, M.giGrid) != null);
  const cxs = ps.map((p) => complexity(p.recs));
  chart("c-mix", { type: "bar", data: { labels: ps.map((p) => p.label), datasets: PKGS.map((pk, i) => ({
      ...barDs(pk, cxs.map((c) => (c.n ? (c[pk.toLowerCase()] / c.n) * 100 : null)), css(`--r${i + 1}`), "m"), _counts: cxs.map((c) => c[pk.toLowerCase()]) })) },
    options: { scales: { x: { stacked: true }, y: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw?.toFixed(0)}% (${c.dataset._counts[c.dataIndex]} cases)` } } } } });
  const sgs = giSurgeons();
  chart("c-cx", { type: "line", data: { labels: ps.map((p) => p.label), datasets: [
      ...sgs.map((s, i) => lineDs(s.name, ps.map((p) => complexity(p.recs, s.id).ci), SCOL(i))),
      { ...lineDs("All gastro", cxs.map((c) => c.ci), css("--ink-2")), borderDash: [5, 4] } ] },
    options: { scales: { y: { beginAtZero: false, min: 1, max: 3, ticks: { stepSize: 0.5, precision: 1 } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? "–" : c.raw.toFixed(2)}` } } } } });

  const dim = $("cx-dim").value; let rows = [];
  if (dim === "surgeon") {
    const recs = rangeKeys().map((k) => S.recs.get(k) || emptyRec(k));
    rows = [...sgs.map((s) => [s.name, complexity(recs, s.id)]), ["All gastro", complexity(recs)]];
  } else {
    rows = periods(dim, rangeKeys()).filter((p) => agg(p.recs, M.giGrid) != null).map((p) => [p.label, complexity(p.recs)]);
  }
  const best = Math.max(...rows.map(([, c]) => c.ci || 0));
  $("t-cx").innerHTML = `<table><tr><th>${dim === "surgeon" ? "Surgeon" : "Period"}</th><th>R1</th><th>R2</th><th>R3</th><th>Total</th><th>R1 %</th><th>R2 %</th><th>R3 %</th><th>R2+R3 %</th><th>Complexity index</th></tr>${rows.map(([n, c]) =>
    `<tr${n === "All gastro" ? ' class="sub"' : ""}><td>${esc(n)}</td><td>${fmt(c.r1)}</td><td>${fmt(c.r2)}</td><td>${fmt(c.r3)}</td><td>${fmt(c.n)}</td><td>${pct(c.n ? c.r1 / c.n : null)}</td><td>${pct(c.n ? c.r2 / c.n : null)}</td><td>${pct(c.n ? c.r3 / c.n : null)}</td><td>${pct(c.hi)}</td><td>${fmt(c.ci, 2)}${c.ci && c.ci === best && rows.length > 1 ? " ▲" : ""}</td></tr>`).join("")}</table>`;
}

/* ---------------- TRAJECTORY: projected (this year's pace) vs expected (last year's growth) ---------------- */
const fyKeys = (fs) => FY_MONTHS.map((mm) => key(mm >= 4 ? fs : fs + 1, mm));
const valAt = (fn, k) => { const r = S.recs.get(k); return r ? fn(r) : null; };
function curFY() {
  const withH = S.keys.filter((k) => S.recs.get(k)?.hosp != null); if (!withH.length) return null;
  const lastK = withH[withH.length - 1]; const t = ym(lastK); return { fs: fyOf(t.y, t.m), lastK };
}
// Like-for-like growth of FY fs over FY fs-1 (only months with data in both, optionally up to a month)
function fyGrowth(fn, fs, upto = null) {
  let a = 0, b = 0, n = 0;
  for (const k of fyKeys(fs)) { if (upto && k > upto) break; const v = valAt(fn, k), p = valAt(fn, addM(k, -12)); if (v == null || p == null) continue; a += v; b += p; n++; }
  return n && b ? { g: a / b - 1, n, a, b } : null;
}
/* Projected = last year's same month × this year's growth so far (current trajectory).
   Expected  = last year's same month × the growth achieved last year (previous trajectory).
   A series without its own prior-year data (gastro and surgeons until Apr 2027) follows its parent
   (hospital → gastro → surgeon) at its current share. */
function trajectory(name, fn, parent) {
  const c = curFY(); if (!c) return null; const { fs, lastK } = c; const ks = fyKeys(fs);
  const actual = ks.map((k) => (k <= lastK ? valAt(fn, k) : null));
  const gC = fyGrowth(fn, fs, lastK), gH = fyGrowth(fn, fs - 1);
  let proj, exp, basis, gP, gE, own = false;
  if (gC && gH) {
    own = true; gP = gC.g; gE = gH.g;
    const base = ks.map((k) => valAt(fn, addM(k, -12)));
    proj = ks.map((k, i) => (k > lastK && base[i] != null ? base[i] * (1 + gP) : null));
    exp = ks.map((k, i) => (base[i] != null ? base[i] * (1 + gE) : null));
    basis = `Own history: projected at this year's ${sgn(gP)}, expected at last year's ${sgn(gE)}`;
  } else if (parent) {
    let a = 0, b = 0;
    ks.forEach((k, i) => { if (k > lastK) return; const v = actual[i], pv = parent.actual[i]; if (v != null && pv != null) { a += v; b += pv; } });
    if (!b) return null; const share = a / b;
    proj = parent.proj.map((v) => (v == null ? null : v * share));
    exp = parent.exp.map((v) => (v == null ? null : v * share));
    gP = parent.gP; gE = parent.gE;
    basis = `${pct(share)} of ${parent.name} (no prior-year data of its own yet)`;
  } else return null;
  const actFYTD = sumN(actual) ?? 0;
  const projTotal = actFYTD + (sumN(proj) ?? 0);
  const expTotal = sumN(exp);
  const expToDate = sumN(ks.map((k, i) => (k <= lastK && actual[i] != null ? exp[i] : null)));
  const lastFY = own ? sumN(fyKeys(fs - 1).map((k) => valAt(fn, k))) : null;
  return { name, fs, lastK, ks, actual, proj, exp, basis, gP, gE, own, actFYTD, projTotal, expTotal, expToDate,
    gap: own && expToDate ? actFYTD / expToDate - 1 : null, lastFY, momentum: (() => {
      const got = ks.map((k, i) => [k, actual[i]]).filter(([k, v]) => k <= lastK && v != null);
      const l3 = got.slice(-3), p3 = got.slice(-6, -3);
      if (p3.length < 3) return null; const a = l3.reduce((x, [, v]) => x + v, 0), b = p3.reduce((x, [, v]) => x + v, 0);
      return b ? { g: a / b - 1, a, b, from: l3[0][0], to: l3[2][0] } : null; })(), projGrowth: lastFY ? projTotal / lastFY - 1 : null,
    expGrowth: lastFY && expTotal ? expTotal / lastFY - 1 : null,
    nextProj: projTotal * (1 + gP), nextExp: expTotal != null ? expTotal * (1 + gE) : null };
}
function allTrajectories() {
  const h = trajectory("Hospital — all robotic", M.hosp); if (!h) return [];
  const g = trajectory("Gastro", M.gi, h);
  const out = [h]; if (g) out.push(g);
  for (const s of giSurgeons()) { const t = trajectory(s.name, M.surgeon(s.id), g); if (t) out.push(t); }
  return out;
}
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
// Datasets for one trajectory: actual, projected (dashed, joined to the last actual point), expected (dotted grey)
function trajDatasets(t, color, cumulative) {
  const last = t.ks.indexOf(t.lastK);
  let act = t.actual.slice(), proj = t.proj.map((v, i) => (i === last ? act[i] : v)), exp = t.exp.slice();
  if (cumulative) {
    const cum = (arr, start = 0) => { let c = start; return arr.map((v) => (v == null ? null : (c += v))); };
    act = cum(act); const actEnd = act[last];
    proj = t.proj.map((v, i) => (i < last ? null : i === last ? actEnd : v)); let c = actEnd; proj = proj.map((v, i) => (i <= last ? v : v == null ? null : (c += v)));
    exp = cum(exp);
  }
  return [
    { ...lineDs(`${fyLabel(t.fs)} actual`, act.map(r1), color), spanGaps: false },
    { ...lineDs(`Projected (this year's ${sgn(t.gP)})`, proj.map(r1), color), borderDash: [7, 5], pointRadius: 0, pointHoverRadius: 4 },
    { ...lineDs(`Expected (last year's ${sgn(t.gE)})`, exp.map(r1), css("--expect")), borderDash: [2, 4], pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
  ];
}
function renderTrajectory() {
  const ts = allTrajectories(); const sel = $("tr-series");
  if (!ts.length) { $("t-traj").innerHTML = '<span class="muted">Not enough data yet.</span>'; return; }
  if (sel.options.length !== ts.length) { const v = sel.value; sel.innerHTML = ts.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join(""); if (v) sel.value = v; }
  const t = ts[+sel.value || 0]; const cumulative = $("tr-view").value === "cum";
  $("tr-title").textContent = `${fyLabel(t.fs)} trajectory — actual vs projected vs expected`;
  const ds = trajDatasets(t, css("--data-1"), cumulative);
  if (!cumulative) ds[0] = { ...barDs(ds[0].label, ds[0].data, css("--data-1")), type: "bar", order: 2 };
  chart("c-traj", { type: "line", data: { labels: FY_MONTHS.map((mm) => MON[mm - 1]), datasets: ds },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? "–" : fmt(c.raw, c.datasetIndex ? 1 : 0)}` } } } } });
  const nf = t.fs + 1;
  $("t-traj").innerHTML = `<table><tr><th>Series</th><th>Actual to ${mLabel(t.lastK)}</th><th>Expected to date</th><th>Actual vs expected</th><th>Last 3 vs prior 3 months</th><th>Projected ${fyLabel(t.fs)}</th><th>Expected ${fyLabel(t.fs)}</th><th>Projected vs ${fyLabel(t.fs - 1)}</th><th>Projected ${fyLabel(nf)}</th><th>Expected ${fyLabel(nf)}</th><th style="text-align:left">Basis</th></tr>${ts.map((x, i) =>
    `<tr${i === (+sel.value || 0) ? ' class="sub"' : ""}><td>${esc(x.name)}</td><td>${fmt(x.actFYTD)}</td><td>${x.own ? fmt(x.expToDate) : "–"}</td><td class="${cls(x.gap)}">${sgn(x.gap)}</td><td class="${cls(x.momentum?.g)}">${x.momentum ? `${sgn(x.momentum.g)} <span class="muted small">(${x.momentum.a} vs ${x.momentum.b})</span>` : "–"}</td><td>${fmt(x.projTotal)}</td><td>${fmt(x.expTotal)}</td><td class="${cls(x.projGrowth)}">${sgn(x.projGrowth)}</td><td>${fmt(x.nextProj)}</td><td>${fmt(x.nextExp)}</td><td class="muted small" style="text-align:left;white-space:normal;min-width:220px">${esc(x.basis)}</td></tr>`).join("")}</table>`;
}

/* ---------------- GROWTH ---------------- */
function seriesList() {
  return [["hosp", "Hospital — all robotic", M.hosp], ["gi", "Gastro", M.gi],
    ...giSurgeons().map((s) => [`s${s.id}`, s.name, M.surgeon(s.id)]), ...PKGS.map((p) => [p, `Gastro ${p}`, M.pkg(p)])];
}
function renderGrowth() {
  renderTrajectory();
  const sel = $("g-series"); const list = seriesList();
  if (sel.options.length !== list.length) { const v = sel.value; sel.innerHTML = list.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""); if (v) sel.value = v; }
  const [, name, fn] = list.find(([id]) => id === sel.value) || list[0];
  const ps = periods(gran(), rangeKeys()).filter((p) => agg(p.recs, fn) != null);
  let cumFy = null, cumKey = null; let prev = null;
  const rows = ps.map((p) => {
    const v = agg(p.recs, fn); const part = isPartial(p, fn);
    const seq = prev != null && prev.v ? v / prev.v - 1 : null; const seqFlag = prev && (prev.part || part);
    const y = yoy(p, fn);
    if (cumKey !== p.fs) { cumKey = p.fs; cumFy = 0; } cumFy += v;
    const row = { p, v, part, seq, seqFlag, y, cumFy }; prev = row; return row;
  });
  chart("c-growth", { type: "bar", data: { labels: rows.map((r) => r.p.label + (r.part ? "*" : "")), datasets: [barDs(name, rows.map((r) => r.v), css("--data-1"))] },
    options: { plugins: { legend: { display: false } } } });
  $("t-growth").innerHTML = `<table><tr><th>Period</th><th>Cases</th><th>vs previous period</th><th>Same period last year (matched months)</th><th>YoY growth</th><th>FY cumulative</th></tr>${rows.map((r) =>
    `<tr><td>${r.p.label}${r.part ? ' <span class="muted small">partial</span>' : ""}</td><td>${fmt(r.v)}</td><td class="${cls(r.seq)}">${sgn(r.seq)}${r.seqFlag && r.seq != null ? " *" : ""}</td><td>${r.y ? fmt(r.y.prev) + (r.y.used < r.p.recs.filter((x) => fn(x) != null).length ? " (part)" : "") : "–"}</td><td class="${cls(r.y?.g)}">${sgn(r.y?.g)}</td><td>${fmt(r.cumFy)}</td></tr>`).join("")}</table>`;
}

/* ---------------- LOOKUP ---------------- */
function lookupRows() {
  const sgs = giSurgeons();
  const cols = ["Period", "FY", "Hospital", "Gastro", "Other specialties", "R1", "R2", "R3", "Complexity index",
    ...sgs.flatMap((s) => [`${s.name} total`, `${s.name} R1`, `${s.name} R2`, `${s.name} R3`]), "Notes"];
  const rows = periods(gran(), rangeKeys()).filter((p) => p.recs.some((r) => r.hosp != null || M.gi(r) != null)).map((p) => {
    const c = complexity(p.recs);
    return [p.label, fyLabel(p.fs), agg(p.recs, M.hosp), agg(p.recs, M.gi), agg(p.recs, M.other),
      agg(p.recs, M.pkg("R1")), agg(p.recs, M.pkg("R2")), agg(p.recs, M.pkg("R3")), c.ci == null ? null : +c.ci.toFixed(2),
      ...sgs.flatMap((s) => [agg(p.recs, M.surgeon(s.id)), ...PKGS.map((pk) => agg(p.recs, M.pkg(pk, s.id)))]),
      p.recs.map((r) => r.notes).filter(Boolean).join("; ")];
  });
  return { cols, rows };
}
function renderLookup() {
  const { cols, rows } = lookupRows(); const q = $("lk-q").value.trim().toLowerCase();
  const f = rows.filter((r) => !q || r.join(" ").toLowerCase().includes(q));
  $("t-lookup").innerHTML = `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${f.map((r) => `<tr>${r.map((v, i) => `<td class="${v == null ? "na" : ""}">${i < 2 || i === r.length - 1 ? esc(v ?? "") : v == null ? "–" : fmt(v, i === 8 ? 2 : 0)}</td>`).join("")}</tr>`).join("")}</table>`;
}
function downloadCsv() {
  const { cols, rows } = lookupRows();
  const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const blob = new Blob([[cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `robotic-programme-${gran()}.csv`; a.click();
}

/* ---------------- ENTRY ---------------- */
const thisMonth = () => { const d = new Date(); return key(d.getFullYear(), d.getMonth() + 1); };
function monthStatus(k) {
  const r = S.recs.get(k); if (!r) return "empty";
  const h = r.hosp != null, g = M.giGrid(r) != null;
  return h && g ? "done" : h || g || r.giEntered != null ? "partial" : "empty";
}
// Financial-year picker: always offers every FY from the first data year up to next FY, so a new year needs no setup.
function renderFyStrip(selKey) {
  const { y, m } = ym(selKey); const fs = fyOf(y, m);
  const t = ym(thisMonth()); const first = S.keys.length ? fyOf(ym(S.keys[0]).y, ym(S.keys[0]).m) : fs;
  const last = Math.max(fyOf(t.y, t.m) + 1, fs);
  const sel = $("e-fy"); const opts = []; for (let f = last; f >= Math.min(first, fs); f--) opts.push(f);
  sel.innerHTML = opts.map((f) => `<option value="${f}">${fyLabel(f)}</option>`).join(""); sel.value = fs;
  const now = thisMonth();
  $("e-months").innerHTML = FY_MONTHS.map((mm) => {
    const k = key(mm >= 4 ? fs : fs + 1, mm); const fut = k > now; const st = fut ? "future" : monthStatus(k);
    return `<button class="chip m-${st}${k === selKey ? " sel" : ""}" ${fut ? "disabled" : ""} data-k="${k}" title="${mLong(k)}: ${({ done: "complete", partial: "partly entered", empty: "not entered", future: "not yet" })[st]}">${MON[mm - 1]}${st === "done" ? " ✓" : st === "partial" ? " •" : ""}</button>`;
  }).join("");
  $("e-months").querySelectorAll("[data-k]").forEach((b) => b.onclick = () => openMonth(b.dataset.k));
  const done = FY_MONTHS.filter((mm) => monthStatus(key(mm >= 4 ? fs : fs + 1, mm)) === "done").length;
  $("e-fy-sum").textContent = `${done} of 12 months complete`;
}
const canEdit = () => ["editor", "admin"].includes(S.role);
const numOrNull = (el) => (el.value === "" ? null : Math.max(0, Math.round(+el.value)));
let giTouched = false;
function openMonth(k) {
  $("e-month").value = k.slice(0, 7);
  const r = S.recs.get(k) || emptyRec(k);
  $("e-hosp").value = r.hosp ?? ""; $("e-notes").value = r.notes ?? "";
  const sgs = S.surgeons.filter((s) => s.department_code === "GI" && (s.active || r.surg[s.id]));
  $("e-grid").innerHTML = `<tr><th>Surgeon</th>${PKGS.map((p) => `<th>${p}</th>`).join("")}<th>Total</th></tr>` +
    sgs.map((s) => `<tr><td>${esc(s.name)}</td>${PKGS.map((p) => `<td><input type="number" min="0" inputmode="numeric" data-s="${s.id}" data-p="${p}" value="${cell(r, s.id, p) ?? ""}"></td>`).join("")}<td data-rt="${s.id}"></td></tr>`).join("") +
    `<tr class="sub"><td>Total</td>${PKGS.map((p) => `<td data-ct="${p}"></td>`).join("")}<td data-ct="all"></td></tr>`;
  giTouched = r.giEntered != null && r.giEntered !== M.giGrid(r);
  $("e-gi").value = r.giEntered ?? M.giGrid(r) ?? "";
  $("e-grid").querySelectorAll("input").forEach((i) => i.oninput = recalcEntry);
  renderFyStrip(k);
  recalcEntry(); $("e-msg").textContent = r.hosp != null || M.giGrid(r) != null ? `Editing existing data for ${mLong(k)}` : `New entry for ${mLong(k)}`;
}
function recalcEntry() {
  const ins = [...$("e-grid").querySelectorAll("input")]; const rt = {}, ct = { R1: null, R2: null, R3: null }; let all = null;
  for (const i of ins) { const v = numOrNull(i); if (v == null) continue; rt[i.dataset.s] = (rt[i.dataset.s] || 0) + v; ct[i.dataset.p] = (ct[i.dataset.p] || 0) + v; all = (all || 0) + v; }
  $("e-grid").querySelectorAll("[data-rt]").forEach((td) => td.textContent = fmt(rt[td.dataset.rt] ?? null));
  $("e-grid").querySelectorAll("[data-ct]").forEach((td) => td.textContent = fmt(td.dataset.ct === "all" ? all : ct[td.dataset.ct]));
  if (!giTouched) $("e-gi").value = all ?? "";
  const h = numOrNull($("e-hosp")), gi = numOrNull($("e-gi")); const w = [];
  if (h != null && gi != null && gi > h) w.push(`Gastro total (${gi}) is more than the hospital total (${h}).`);
  if (gi != null && all != null && gi !== all) w.push(`Gastro total (${gi}) differs from the surgeon grid (${all}). Saved as entered.`);
  $("e-warn").innerHTML = w.join("<br>"); $("e-warn").classList.toggle("hidden", !w.length);
}
async function saveMonth() {
  const k = `${$("e-month").value}-01`; if (!/^\d{4}-\d{2}-01$/.test(k)) return toast("Pick a month first");
  const btn = $("e-save"); btn.disabled = true; $("e-msg").textContent = "Saving…";
  try {
    const h = numOrNull($("e-hosp")), gi = numOrNull($("e-gi")), notes = $("e-notes").value.trim() || null;
    const ops = [];
    if (h != null || notes) ops.push(sb.from("rp_hospital_month").upsert({ month: k, total_cases: h, notes }));
    else ops.push(sb.from("rp_hospital_month").delete().eq("month", k));
    for (const [code, v] of [["GI", gi]]) {
      ops.push(v != null ? sb.from("rp_department_month").upsert({ month: k, department_code: code, cases: v })
                         : sb.from("rp_department_month").delete().eq("month", k).eq("department_code", code));
    }
    const ups = [], dels = [];
    for (const i of $("e-grid").querySelectorAll("input")) { const v = numOrNull(i); const row = { month: k, surgeon_id: +i.dataset.s, package: i.dataset.p, platform: "all" }; v == null ? dels.push(row) : ups.push({ ...row, cases: v }); }
    if (ups.length) ops.push(sb.from("rp_surgeon_month").upsert(ups));
    for (const d of dels) ops.push(sb.from("rp_surgeon_month").delete().match(d));
    const res = await Promise.all(ops); const err = res.find((r) => r.error);
    if (err) throw err.error;
    await loadAll(); renderFyStrip(k); $("e-msg").textContent = `Saved ${mLong(k)} ✓`; toast(`Saved ${mLong(k)}`);
  } catch (e) { $("e-msg").textContent = "Save failed: " + (e.message || e); }
  finally { btn.disabled = false; }
}

/* ---------------- ADMIN ---------------- */
async function renderAdmin() {
  const [acc, aud] = await Promise.all([sb.from("rp_access").select("*").order("email"), sb.from("rp_audit").select("*").order("changed_at", { ascending: false }).limit(40)]);
  $("acc-list").innerHTML = `<table><tr><th>Email</th><th>Role</th><th></th></tr>${(acc.data || []).map((a) => `<tr><td>${esc(a.email)}</td><td>${a.role}</td><td>${a.email === S.user.email ? "" : `<button class="btn small" data-del="${esc(a.email)}">Remove</button>`}</td></tr>`).join("")}</table>`;
  $("acc-list").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.del}?`)) return; await sb.from("rp_access").delete().eq("email", b.dataset.del); renderAdmin(); });
  $("sg-dept").innerHTML = S.depts.map((d) => `<option value="${d.code}">${esc(d.name)}</option>`).join("");
  $("sg-list").innerHTML = `<table><tr><th>Name</th><th>Department</th><th>Active</th></tr>${S.surgeons.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.department_code}</td><td><input type="checkbox" data-sid="${s.id}" ${s.active ? "checked" : ""}></td></tr>`).join("")}</table>`;
  $("sg-list").querySelectorAll("[data-sid]").forEach((c) => c.onchange = async () => { await sb.from("rp_surgeons").update({ active: c.checked }).eq("id", +c.dataset.sid); await loadAll(); });
  const desc = (r) => { const x = r.new_row || r.old_row || {}; return `${x.month ? mLong(x.month) : ""} ${x.department_code || ""} ${x.surgeon_id ? (S.surgeons.find((s) => s.id === x.surgeon_id)?.name || "") + " " + x.package : ""}`.trim(); };
  const val = (x) => (x ? x.total_cases ?? x.cases ?? "" : "");
  $("audit").innerHTML = `<table><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr>${(aud.data || []).map((r) => `<tr><td>${new Date(r.changed_at).toLocaleString("en-IN")}</td><td>${esc(r.changed_by || "")}</td><td>${esc(desc(r))}</td><td>${r.action === "INSERT" ? "set " + val(r.new_row) : r.action === "DELETE" ? "cleared (was " + val(r.old_row) + ")" : val(r.old_row) + " → " + val(r.new_row)}</td></tr>`).join("")}</table>`;
}

/* ---------------- routing / auth ---------------- */
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${t}`));
  $("filters").classList.toggle("hidden", ["entry", "admin"].includes(t));
  render();
}
function render() {
  try {
    ({ dashboard: renderDashboard, contribution: renderContribution, surgeons: renderSurgeons, complexity: renderComplexity, growth: renderGrowth, lookup: renderLookup, admin: renderAdmin, entry: () => {} })[S.tab]();
  } catch (e) { console.error(e); toast("Render error: " + e.message); }
}
function show(which) { for (const id of ["login", "denied", "app"]) $(id).classList.toggle("hidden", id !== which); }

async function onSession(session) {
  if (!session) { S.user = null; $("who").innerHTML = ""; show("login"); return; }
  S.user = session.user;
  const { data } = await sb.from("rp_access").select("role").eq("email", (S.user.email || "").toLowerCase()).maybeSingle();
  S.role = data?.role || null;
  $("who").innerHTML = `<span>${esc(S.user.email)}</span>${S.role ? `<span class="badge">${S.role}</span>` : ""}<button class="btn small" data-action="signout">Sign out</button>`;
  bindSignout();
  if (!S.role) { $("denied-email").textContent = S.user.email; show("denied"); return; }
  document.querySelectorAll("[data-role]").forEach((b) => b.classList.toggle("hidden", b.dataset.role === "admin" ? S.role !== "admin" : !canEdit()));
  show("app");
  try { await loadAll(); } catch (e) { toast("Load failed: " + e.message); return; }
  openMonth(lastCompleteMonth());
  switchTab(S.tab);
}
function bindSignout() { document.querySelectorAll('[data-action="signout"]').forEach((b) => b.onclick = async () => { await sb.auth.signOut(); onSession(null); }); }

function init() {
  const back = location.origin + location.pathname;
  $("btn-google").onclick = () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: back } });
  $("form-email").onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.auth.signInWithOtp({ email: $("email").value.trim(), options: { emailRedirectTo: back } }); $("login-msg").textContent = error ? error.message : "Check your inbox for the sign-in link."; };
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  ["f-gran", "f-from", "f-to", "cx-dim", "g-series", "tr-series", "tr-view"].forEach((id) => $(id).onchange = render);
  $("lk-q").oninput = renderLookup; $("lk-csv").onclick = downloadCsv;
  $("e-month").onchange = () => $("e-month").value && openMonth(`${$("e-month").value}-01`);
  ["e-hosp"].forEach((id) => $(id).oninput = recalcEntry);
  $("e-gi").oninput = () => { giTouched = $("e-gi").value !== ""; recalcEntry(); };
  $("e-save").onclick = saveMonth;
  $("e-fy").onchange = () => { const f = +$("e-fy").value; const now = thisMonth();
    const ks = FY_MONTHS.map((mm) => key(mm >= 4 ? f : f + 1, mm)).filter((k) => k <= now);
    openMonth(ks.find((k) => monthStatus(k) !== "done") || ks[ks.length - 1] || key(f, 4)); };
  $("e-month").max = thisMonth().slice(0, 7);
  $("f-to").addEventListener("change", () => { S.toPinned = true; });
  $("acc-form").onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from("rp_access").upsert({ email: $("acc-email").value.trim().toLowerCase(), role: $("acc-role").value }); if (error) return toast(error.message); $("acc-email").value = ""; renderAdmin(); };
  $("sg-form").onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from("rp_surgeons").insert({ name: $("sg-name").value.trim(), department_code: $("sg-dept").value, sort: S.surgeons.length + 1 }); if (error) return toast(error.message); $("sg-name").value = ""; await loadAll(); renderAdmin(); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  bindSignout();
  let lastUid = undefined;
  sb.auth.onAuthStateChange((ev, session) => {
    const uid = session?.user?.id ?? null;
    if (uid === lastUid) return; lastUid = uid;
    setTimeout(() => onSession(session), 0); // never await Supabase calls inside this callback
  });
}
init();
})();
