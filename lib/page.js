// Per-app page config, <dir>/page.json next to charts.json — optional, and the page
// renders exactly as before without it (and <dir>/phrases.json, the footer easter
// egg's lines — see loadPhrases):
//
//   labels      store name → label shown in legends and tooltips
//   groupNotes  chart group → one paragraph under the group heading
//   hero        { chart, noun, parts: [{ series, text, class? }] } — the headline as
//               shares of one chart's last values
//
// Pure functions, shared by app.js and scripts/page.test.mjs.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// `url` is the body's data-page-config, stamped only when the app has a page.json.
export async function loadPage(fetchFn = fetch, url = "page.json") {
  if (!url) return {};
  try {
    const r = await fetchFn(url, { cache: "no-store" });
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

// `url` is the body's data-phrases, stamped only when the app has its own list; the
// mascot then speaks in its own voice instead of the shared one. Anything unusable —
// missing file, network error, not a non-empty array — keeps the shared list, so the
// egg never goes silent.
export async function loadPhrases(fetchFn, url, shared) {
  if (!url) return shared;
  try {
    const r = await fetchFn(url, { cache: "no-store" });
    if (!r.ok) return shared;
    const list = await r.json();
    return Array.isArray(list) && list.length ? list : shared;
  } catch {
    return shared;
  }
}

// The app's map wins, the built-in map is the fallback, an unknown name is its own label.
export function labeller(builtin, appLabels = {}) {
  return (name) => appLabels[name] ?? builtin[name] ?? name;
}

export function sectionNote(notes, group) {
  const note = notes?.[group];
  return note ? `<p class="section-note">${esc(note)}</p>` : "";
}

const lastValue = (series) => (series?.points?.length ? series.points[series.points.length - 1][1] : 0);

export function heroThesis(meta, page, chartData) {
  const decl = page?.hero;
  if (decl) {
    const series = chartData?.[decl.chart]?.series ?? [];
    const total = series.reduce((sum, s) => sum + lastValue(s), 0);
    if (!total) return "";
    const parts = decl.parts.map((part, i) => {
      const pct = Math.round((lastValue(series.find((s) => s.name === part.series)) / total) * 100);
      const figure = part.class ? `<b class="${esc(part.class)}">${pct}%</b>` : `<b>${pct}%</b>`;
      const of = i === 0 ? ` of ${total} ${esc(decl.noun)}` : "";
      return `${figure}${of} ${esc(part.text)}`;
    });
    return `<span class="hero-stat">${parts.join(", ")}</span>`;
  }
  const h = meta?.hero || {};
  return h.swift6Total ? `<span class="hero-stat"><b>${h.swift6Pct}%</b> of ${h.swift6Total} modules on Swift 6</span>` : "";
}
