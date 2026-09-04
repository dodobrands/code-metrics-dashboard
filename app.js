// Renders the dashboard from charts.json (spec) + data/meta.json (bounds/hero)
// + one data/charts/<id>.json per chart (only that chart's series).
// Related series share one chart; shares/versions render as 100% stacked areas.

import Chart from "chart.js/auto";
import zoomPlugin from "chartjs-plugin-zoom";
import { heroThesis, labeller, loadPage, sectionNote } from "./lib/page.js";
import logo from "./logo.txt";
import phrases from "./phrases.json";
import { typo, typographize } from "./typo.js";

Chart.register(zoomPlugin);

// Careers easter egg — anyone who opens the console meets the Dodo logo and,
// if the bird catches their eye, a way in. The logo lives in logo.txt, pulled
// into the bundle at build time by esbuild's text loader; it prints verbatim,
// only the invitation below is styled.
console.log(logo);
console.log(
  "%cDodo's iOS team is hiring → https://dodoteam.ru/vacancies/",
  "font:600 13px 'Martian Mono',ui-monospace,monospace;color:#f05138",
);
// Axis ticks and legend default to Chart.js' own sans-serif; match the page's mono.
Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue("--mono").trim();
// The webfont loads async; re-render once it's ready so canvases aren't stuck on the fallback.
document.fonts.ready.then(() => {
  for (const c of charts) c.update();
});

// dataviz categorical palette (validated: adjacent-pair CVD dE 9.1 light / 8.4 dark).
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const NAMES = {
  "Task\\b.*\\{.*@MainActor": "Task { @MainActor }",
  "@available(*, deprecated": "@available deprecated",
  // Snapshot coverage ships one pair per pool; the pool is the segmented control's
  // job to say, so the legend only names the two halves.
  "Snapshot:All:Covered": "Covered",
  "Snapshot:All:Bare": "Not covered",
  "Snapshot:SwiftUI:Covered": "Covered",
  "Snapshot:SwiftUI:Bare": "Not covered",
  "Snapshot:UIKit:Covered": "Covered",
  "Snapshot:UIKit:Bare": "Not covered",
};
// The built-in map is the fallback; an app's page.json labels win (see main).
let nameOf = labeller(NAMES);

// Every mounted chart, so the date-range picker can retarget all their x-axes.
const charts = [];
// Every mounted chart, reachable from the console: the bundle keeps Chart itself
// private, so without this a rendering question can only be answered by squinting.
window.dashboardCharts = charts;
// The range selector rewrites every mounted chart, but a folded module grid has no
// charts yet: opening it later would build cells on the full history while the card
// above them shows a week. The chosen window is kept here so a late chart is born
// with it.
let axisWindow = null;

// Create a chart and wire double-click to reset any zoom/pan on it.
// Chart.js paints into a canvas, so a pinch magnifies pixels that are already on
// screen: Safari scales the visual viewport without firing a resize on the element,
// and the chart never learns it should repaint. Feeding the pinch factor back in as
// the device pixel ratio is what makes the lines sharp at the size actually being
// looked at.
//
// Only charts on screen are repainted, and the factor is capped: the backing buffer
// grows with the square of the ratio, so repainting every card at a triple pinch
// would cost hundreds of megabytes for the ones nobody is looking at.
const onScreen = new Set();
const watcher = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.target.isConnected) {
      watcher.unobserve(entry.target);
      continue;
    }
    const chart = charts.find((c) => c.canvas === entry.target);
    if (!chart) continue;
    if (entry.isIntersecting) {
      onScreen.add(chart);
      sharpen(chart);
    } else {
      onScreen.delete(chart);
    }
  }
});

function sharpen(chart) {
  const pinch = Math.min(window.visualViewport?.scale ?? 1, 3);
  const ratio = (window.devicePixelRatio || 1) * pinch;
  if (chart.options.devicePixelRatio === ratio) return;
  chart.options.devicePixelRatio = ratio;
  chart.resize();
}

window.visualViewport?.addEventListener("resize", () => {
  for (const chart of onScreen) sharpen(chart);
});

function mount(canvas, config) {
  if (axisWindow) Object.assign(config.options.scales.x, axisWindow);
  const chart = new Chart(canvas, config);
  watcher.observe(canvas);
  canvas.title = "scroll to zoom · shift-drag to pan · double-click to reset";
  canvas.ondblclick = () => chart.resetZoom();
  charts.push(chart);
  return chart;
}

// Min/max timestamp across a chart's own series — for charts that scale to
// their own data range (`selfBounds`) instead of the shared full-history axis,
// so a young metric isn't a flat line squished at the far right.
function seriesBounds(byName) {
  let min = Infinity, max = -Infinity;
  for (const s of byName.values())
    for (const [t] of s.points) { if (t < min) min = t; if (t > max) max = t; }
  return Number.isFinite(min) && max > min ? { min, max } : null;
}

const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);
function ink() {
  const s = getComputedStyle(document.body);
  return { grid: s.getPropertyValue("--grid").trim(), muted: s.getPropertyValue("--muted").trim() };
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const commonScales = (bounds) => {
  const { muted } = ink();
  const grid = isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  return {
    x: { type: "linear", min: bounds.min, max: bounds.max, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 8, callback: (v) => new Date(v).getFullYear(), font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, font: { size: 11 } } },
  };
};
const legendConfig = () => ({ display: true, position: "bottom", labels: { color: ink().muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "line", padding: 16, font: { size: 11 } } });
const tooltipConfig = (fmt) => ({ callbacks: { title: (i) => new Date(i[0].parsed.x).toISOString().slice(0, 10), label: (i) => ` ${i.dataset.label}: ${fmt(i.parsed.y)}` } });
const ZOOM = {
  zoom: { wheel: { enabled: true }, drag: { enabled: true, backgroundColor: hexA("#f05138", 0.12), borderColor: hexA("#f05138", 0.5), borderWidth: 1 }, mode: "x" },
  pan: { enabled: true, mode: "x", modifierKey: "shift" },
};
// layout.padding insets the plot from the canvas edges — same 4px scale as CSS
// (8 = --sp-2, 16 = --sp-4) so the 100% area never hugs the card border.
// zoom/pan is clamped to the data extent [bounds.min, bounds.max] via limits.x.
const baseOptions = (scales, single, bounds) => ({ responsive: true, maintainAspectRatio: false, animation: false, normalized: true, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } }, plugins: { legend: single ? { display: false } : legendConfig(), zoom: { ...ZOOM, limits: { x: { min: bounds.min, max: bounds.max, minRange: 864e5 } } } }, scales });

function lineChart(canvas, spec, byName, bounds) {
  const colors = palette();
  // A chart without an explicit `series` list draws every series in its data
  // file — used for dynamic sets like the per-type build warnings.
  const names = spec.series ?? [...byName.keys()];
  const datasets = names.filter((n) => byName.has(n)).map((n, i) => ({
    label: nameOf(n), data: byName.get(n).points.map(([x, y]) => ({ x, y })),
    borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
    borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3, tension: 0.12, fill: false,
  }));
  const opts = baseOptions(commonScales(bounds), datasets.length === 1, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y}`);
  mount(canvas, { type: "line", data: { datasets }, options: opts });
}

// Ranked horizontal bars from each series' latest value. For high-cardinality
// breakdowns (by module / by message) where 40+ overlapping lines are
// unreadable and the shared-index tooltip covers the whole plot. A snapshot,
// not a time series — so it isn't registered with the date-range picker.
// Rank {label,value} rows desc, drop zeros, fold the tail past topN into "Other".
// Shares never fold the way counts do: summing percentages into an "Other" row
// would be a number that means nothing, and a module sitting at 0% is the whole
// point of looking, so zeros stay. Best first, like every other ranked list here.
function rankShares(items, topN) {
  const rows = items.sort((a, b) => b.value - a.value);
  return topN ? rows.slice(0, topN) : rows;
}

function rankRows(items, topN) {
  let rows = items.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (topN && rows.length > topN) {
    const rest = rows.slice(topN).reduce((s, r) => s + r.value, 0);
    rows = rows.slice(0, topN);
    if (rest > 0) rows.push({ label: "Other", value: rest });
  }
  return rows;
}

// Draw ranked horizontal bars; returns the Chart so a toggle can destroy and
// redraw it. Grows the card so every bar keeps a legible height.
function drawBars(canvas, rows, percent = false) {
  const colors = palette();
  const { muted } = ink();
  const grid = isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  canvas.parentElement.style.height = `${Math.max(160, rows.length * 22 + 24)}px`;
  return new Chart(canvas, {
    type: "bar",
    data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.value), backgroundColor: colors[0], borderRadius: 3, barThickness: 12 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, indexAxis: "y",
      // Long labels (a few method signatures) truncate with an ellipsis; the
      // untruncated label is the tooltip title.
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => items[0].label, label: (i) => ` ${i.parsed.x}${percent ? "%" : ""}` } } },
      scales: {
        x: { beginAtZero: true, max: percent ? 100 : undefined, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, precision: 0, callback: (v) => (percent ? `${v}%` : v) } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 28 ? `${l.slice(0, 27)}…` : l; } } },
      },
    },
  });
}

function barChart(canvas, spec, byName) {
  const names = spec.series ?? [...byName.keys()];
  const items = names.filter((n) => byName.has(n)).map((n) => {
    const p = byName.get(n).points;
    return { label: nameOf(n), value: p.length ? p[p.length - 1][1] : 0 };
  });
  drawBars(canvas, rankRows(items, spec.topN));
}

// A bar chart with a segmented control that switches between prefix groups
// (e.g. deprecations by symbol / by module). The data file carries every
// group's series under its full `Prefix:name`; split by the active group's
// prefix and redraw on switch.
function toggleBarChart(card, canvas, spec, byName) {
  const ctrl = document.createElement("div");
  ctrl.className = "chart-toggle";
  let chart = null;
  const render = (gi) => {
    const g = spec.toggle[gi];
    const items = [...byName.keys()].filter((n) => n.startsWith(g.seriesPrefix)).map((n) => {
      const p = byName.get(n).points;
      return { label: n.slice(g.seriesPrefix.length), value: p.length ? p[p.length - 1][1] : 0 };
    });
    chart?.destroy();
    chart = spec.percent
      ? drawBars(canvas, rankShares(items, g.topN), true)
      : drawBars(canvas, rankRows(items, g.topN));
    for (const [i, b] of [...ctrl.children].entries()) b.setAttribute("aria-pressed", String(i === gi));
  };
  spec.toggle.forEach((g, gi) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chart-toggle-btn";
    b.textContent = g.label;
    b.onclick = () => render(gi);
    ctrl.appendChild(b);
  });
  card.querySelector("figcaption").appendChild(ctrl);
  render(0);
}

// The per-module grid is folded away: forty-two cells are a detail you open when
// the headline raises a question, not something to scroll past every visit. The
// cells are built on first open — Chart.js cannot size a canvas inside a closed
// <details>, and an unopened grid costs nothing this way.
function moduleDisclosure(canvas, count, paint) {
  const details = document.createElement("details");
  details.className = "modules";
  const summary = document.createElement("summary");
  summary.textContent = `By module · ${count}`;
  const grid = document.createElement("div");
  grid.className = "canvas-wrap sparks";
  details.append(summary, grid);
  canvas.parentElement.after(details);

  let stale = true;
  details.addEventListener("toggle", () => {
    if (details.open && stale) {
      paint(grid);
      stale = false;
    }
  });
  return { grid, invalidate: () => { stale = true; if (details.open) { paint(grid); stale = false; } } };
}

// The migration chart with the same grid underneath: the repository's SwiftUI/UIKit
// balance on top, then each module's own. Cells stack the two frameworks rather
// than drawing one line, so a module reads the way the headline does.
function migrationChart(_card, canvas, spec, byName, bounds) {
  const prefix = spec.moduleSeriesPrefix;
  const modules = [...new Set(
    [...byName.keys()]
      .filter((n) => n.startsWith(prefix) && n.endsWith(":SwiftUI"))
      .map((n) => n.slice(prefix.length, -":SwiftUI".length)),
  )].sort((a, b) => a.localeCompare(b));

  shareChart(canvas, spec, byName, bounds);
  moduleDisclosure(canvas, modules.length, (grid) => paintModules(grid));

  function paintModules(grid) {
    grid.textContent = "";
    for (const module of modules) {
    const sui = byName.get(`${prefix}${module}:SwiftUI`)?.points ?? [];
    const uik = byName.get(`${prefix}${module}:UIKit`)?.points ?? [];
    const total = tail(sui) + tail(uik);
    const cell = document.createElement("figure");
    cell.className = total ? "spark" : "spark bare";
    const value = total
      ? `<b style="color:${shareColour((tail(sui) / total) * 100)}">${Math.round((tail(sui) / total) * 100)}%</b>`
      : '<b class="none">—</b>';
    cell.innerHTML = `<figcaption>${escapeHtml(module)}</figcaption><div class="spark-row"><div class="spark-canvas">${total ? "<canvas></canvas>" : '<p class="none">no views</p>'}</div>${value}</div>`;
      grid.appendChild(cell);
      if (total) miniStack(cell.querySelector("canvas"), sui, uik, bounds);
    }
  }
}

const tail = (points) => (points.length ? points[points.length - 1][1] : 0);

// A cell-sized version of the 100% stack: two areas, no axes, no interaction.
//
// The two series are sampled independently, so their timestamps rarely coincide —
// intersecting them would leave a module with one or two points, and a module with
// no SwiftUI at all with none. Walk the union instead, carrying the last known
// count on each side, which is what the series means between samples anyway.
function miniStack(canvas, swiftUI, uiKit, bounds) {
  const sui = new Map(swiftUI), uik = new Map(uiKit);
  const stamps = [...new Set([...sui.keys(), ...uik.keys()])].sort((a, b) => a - b);
  let lastSui = 0, lastUik = 0;
  const shares = [];
  for (const ts of stamps) {
    lastSui = sui.get(ts) ?? lastSui;
    lastUik = uik.get(ts) ?? lastUik;
    const sum = lastSui + lastUik;
    if (sum > 0) shares.push({ x: ts, y: (lastSui / sum) * 100 });
  }
  const colours = palette();
  return mount(canvas, {
    type: "line",
    data: {
      datasets: [
        { data: shares, borderColor: colours[0], backgroundColor: hexA(colours[0], 0.75), borderWidth: 0, pointBackgroundColor: colours[0], pointRadius: dotIfCramped(shares.map((p) => [p.x]), 0), fill: "origin", tension: 0 },
        { data: shares.map((p) => ({ x: p.x, y: 100 - p.y })), borderColor: colours[1], backgroundColor: hexA(colours[1], 0.75), borderWidth: 0, pointRadius: 0, fill: "-1", tension: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true, events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false }, zoom: undefined },
      scales: {
        x: { type: "linear", display: false, min: bounds.min, max: bounds.max },
        y: { display: false, stacked: true, min: 0, max: 100 },
      },
    },
  });
}

// Snapshot coverage in one card: the repository's share on top, every module's own
// line underneath, one segmented control driving both. Split apart they answered
// the same question twice — how covered are we, and covered where.
function coverageChart(card, canvas, spec, byName, bounds) {
  // Alphabetical, and the same in every pool: a module keeps its place when the
  // reader switches frameworks, and a name can be found without reading the whole
  // grid. Ranking by coverage would reshuffle the cells three different ways and
  // answer a question the sparklines already show by shape.
  const canonical = `${spec.toggle[0].seriesPrefix}ByModule:`;
  const order = [...byName.keys()]
    .filter((n) => n.startsWith(canonical))
    .map((n) => n.slice(canonical.length))
    .sort((a, b) => a.localeCompare(b));

  let share = null;
  let current = spec.toggle[0].seriesPrefix;
  const mounted = [];
  const modules = moduleDisclosure(canvas, order.length, (grid) => paintModules(grid));

  const render = (prefix) => {
    if (share) {
      charts.splice(charts.indexOf(share), 1);
      share.destroy();
    }
    for (const chart of mounted.splice(0)) {
      charts.splice(charts.indexOf(chart), 1);
      chart.destroy();
    }
    share = shareChart(canvas, { ...spec, series: [`${prefix}Covered`, `${prefix}Bare`] }, byName, bounds);

    current = prefix;
    modules.invalidate();
  };

  function paintModules(grid) {
    const prefix = current;
    grid.textContent = "";
    for (const module of order) {
      const series = byName.get(`${prefix}ByModule:${module}`);
      const points = series?.points ?? [];
      const cell = document.createElement("figure");
      cell.className = points.length ? "spark" : "spark bare";
      // The number sits at the end of the line rather than up in the caption: the
      // eye follows the curve and finds the value where the curve stops.
      const value = points.length
        ? `<b style="color:${shareColour(last(series))}">${last(series).toFixed(0)}%</b>`
        : '<b class="none">—</b>';
      cell.innerHTML = `<figcaption>${escapeHtml(module)}</figcaption><div class="spark-row"><div class="spark-canvas">${points.length ? "<canvas></canvas>" : '<p class="none">no views</p>'}</div>${value}</div>`;
      grid.appendChild(cell);
      if (points.length) mounted.push(sparkline(cell.querySelector("canvas"), points, bounds));
    }
  }

  const ctrl = document.createElement("div");
  ctrl.className = "chart-toggle";
  spec.toggle.forEach((g, gi) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chart-toggle-btn";
    button.textContent = g.label;
    button.onclick = () => {
      render(g.seriesPrefix);
      for (const [i, other] of [...ctrl.children].entries()) other.setAttribute("aria-pressed", String(i === gi));
    };
    ctrl.appendChild(button);
  });
  card.querySelector("figcaption").appendChild(ctrl);
  ctrl.children[0].click();
}

const last = (series) => (series.points.length ? series.points[series.points.length - 1][1] : 0);

// Whether a cell got drawn is a question for Chart.js, not for a rule of thumb: its
// own x-scale converts the module's first and last commit into pixel positions, and
// under two pixels apart the line has nowhere to go. A module that young has no
// shape to show anyway, so it falls back to dots at its values — on the same shared
// axis, where their position still says "this only just appeared".
//
// It has to be a scriptable option rather than a one-off measurement or a plugin
// that writes a number: the range selector rewrites the axis under a live chart, a
// week-wide axis gives the same module all the room it needs, and the dots have to
// go away again. Chart.js caches element options it considers static and reuses them
// across updates — a function is what makes it ask every time.
const dotIfCramped = (points, radius) => {
  const stamps = points.map(([x]) => x);
  const lo = Math.min(...stamps), hi = Math.max(...stamps);
  return (ctx) => {
    const scale = ctx.chart.scales.x;
    if (scale?.width && scale.getPixelForValue(hi) - scale.getPixelForValue(lo) < 2) return 2.5;
    return typeof radius === "function" ? radius(ctx) : radius;
  };
};

// One sparkline: the line, its endpoint, and nothing else. The y-axis is pinned to
// 0–100 so cells are comparable at a glance rather than each scaling to itself.
function sparkline(canvas, points, bounds) {
  const value = points.length ? points[points.length - 1][1] : 0;
  const colour = shareColour(value);
  return mount(canvas, {
    type: "line",
    data: {
      datasets: [{
        data: points.map(([x, y]) => ({ x, y })),
        borderColor: colour, borderWidth: 1.75, tension: 0.25,
        pointRadius: dotIfCramped(points, (c) => (c.dataIndex === points.length - 1 ? 2.5 : 0)),
        pointBackgroundColor: colour, fill: "origin",
        backgroundColor: hexA(colour, 0.12),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      // No legend, no tooltip, no zoom: the cell says the module and its number in
      // the caption, and the line says the shape. Anything else is a second reading
      // of what is already on screen, forty times over.
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false }, zoom: undefined },
      scales: {
        x: { type: "linear", display: false, min: bounds.min, max: bounds.max },
        y: { display: false, min: 0, max: 100 },
      },
    },
  });
}

// Coverage colour ramp: brick at nothing, sand mid-way, green at covered.
function shareColour(percent) {
  const stops = [[0, [176, 74, 52]], [50, [198, 155, 74]], [100, [74, 148, 106]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (percent <= b) {
      const t = b > a ? (percent - a) / (b - a) : 0;
      const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * t));
      return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#4a946a";
}

// A share chart behind the same segmented control the bar charts use. Each group
// is a series prefix holding one covered/uncovered pair — snapshot coverage for
// every view, then for SwiftUI and UIKit apart. Switching replaces the chart, so
// the old one leaves the registry the date picker retargets.
function toggleShareChart(card, canvas, spec, byName, bounds) {
  const ctrl = document.createElement("div");
  ctrl.className = "chart-toggle";
  let current = null;
  const render = (gi) => {
    const g = spec.toggle[gi];
    const names = [...byName.keys()].filter((n) => n.startsWith(g.seriesPrefix));
    const covered = names.find((n) => n.endsWith(":Covered"));
    const bare = names.find((n) => n !== covered);
    if (!covered || !bare) return;
    if (current) {
      charts.splice(charts.indexOf(current), 1);
      current.destroy();
    }
    current = shareChart(canvas, { ...spec, series: [covered, bare] }, byName, bounds);
    for (const [i, b] of [...ctrl.children].entries()) b.setAttribute("aria-pressed", String(i === gi));
  };
  spec.toggle.forEach((g, gi) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chart-toggle-btn";
    b.textContent = g.label;
    b.onclick = () => render(gi);
    ctrl.appendChild(b);
  });
  card.querySelector("figcaption").appendChild(ctrl);
  render(0);
}

// Stacked 100% area from a set of series (SwiftUI/UIKit) or a version histogram.
function stack100(canvas, datasets, bounds) {
  const scales = commonScales(bounds);
  scales.y = { ...scales.y, stacked: true, min: 0, max: 100, ticks: { ...scales.y.ticks, callback: (v) => `${v}%` } };
  const opts = baseOptions(scales, false, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y.toFixed(1)}%`);
  opts.plugins.tooltip.filter = (item) => item.parsed.y > 0; // hide 0% rows
  return mount(canvas, { type: "line", data: { datasets }, options: opts });
}

function shareChart(canvas, spec, byName, bounds) {
  const colors = palette();
  const [a, b] = spec.series;
  const ma = new Map(byName.get(a).points), mb = new Map(byName.get(b).points);
  const ts = [...ma.keys()].filter((t) => mb.has(t)).sort((x, y) => x - y);
  const pa = [], pb = [];
  for (const t of ts) {
    const sum = ma.get(t) + mb.get(t), share = sum > 0 ? (ma.get(t) / sum) * 100 : 0;
    pa.push({ x: t, y: share }); pb.push({ x: t, y: 100 - share });
  }
  return stack100(canvas, [
    { label: nameOf(a), data: pa, borderColor: colors[0], backgroundColor: hexA(colors[0], 0.78), borderWidth: 0, pointRadius: 0, fill: "origin", tension: 0 },
    { label: nameOf(b), data: pb, borderColor: colors[1], backgroundColor: hexA(colors[1], 0.78), borderWidth: 0, pointRadius: 0, fill: "-1", tension: 0 },
  ], bounds);
}

// Swift version share — newest version at the bottom so it grows upward.
function versionsChart(canvas, spec, byName, bounds) {
  const colors = palette();
  const metric = byName.get(spec.series[0]);
  const asc = [...new Set(metric.points.flatMap(([, h]) => Object.keys(h)))].sort();
  const colorOf = (v) => colors[asc.indexOf(v) % colors.length];
  const datasets = [...asc].reverse().map((ver) => ({
    label: `Swift ${ver}`,
    data: metric.points.map(([t, h]) => {
      const total = Object.values(h).reduce((s, n) => s + n, 0);
      return { x: t, y: total ? ((h[ver] || 0) / total) * 100 : 0 };
    }),
    borderColor: colorOf(ver), backgroundColor: hexA(colorOf(ver), 0.85), borderWidth: 0, pointRadius: 0, fill: true, tension: 0,
  }));
  stack100(canvas, datasets, bounds);
}

// --- date-range picker --------------------------------------------------------

const DAY = 864e5;
const RANGES = [
  { label: "All time", ms: null },
  { label: "Last 5 years", ms: 5 * 365 * DAY },
  { label: "Last 3 years", ms: 3 * 365 * DAY },
  { label: "Last year", ms: 365 * DAY },
  { label: "Last 6 months", ms: 182 * DAY },
  { label: "Last 3 months", ms: 91 * DAY },
  { label: "Last month", ms: 30 * DAY },
  { label: "Last week", ms: 7 * DAY },
];
function rangePicker(bounds) {
  const sel = document.getElementById("rangepick");
  if (!sel) return;
  for (const r of RANGES) {
    const o = document.createElement("option");
    o.textContent = r.label;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    const r = RANGES[sel.selectedIndex];
    const min = r.ms == null ? bounds.min : Math.max(bounds.min, bounds.max - r.ms);
    axisWindow = { min, max: bounds.max };
    for (const c of charts) {
      c.options.scales.x.min = min;
      c.options.scales.x.max = bounds.max;
      c.update("none");
    }
  };
}

// -----------------------------------------------------------------------------

async function main() {
  const [specs, meta, page] = await Promise.all([
    fetch("charts.json").then((r) => r.json()),
    fetch("data/meta.json", { cache: "no-store" }).then((r) => r.json()),
    loadPage(fetch, document.body.dataset.pageConfig),
  ]);
  nameOf = labeller(NAMES, page.labels);
  if (meta.repo) document.getElementById("repo").textContent = meta.repo;
  const hero = document.getElementById("hero");
  if (!page.hero) {
    hero.innerHTML = heroThesis(meta, page);
    typographize(hero); // settle the hero now, before the next await paints it
  }
  const bounds = meta.bounds;

  // Each chart's data lives in its own file — fetch them all in parallel.
  const datas = await Promise.all(specs.map((s) => fetch(`data/charts/${s.id}.json`, { cache: "no-store" }).then((r) => r.json())));
  if (page.hero) {
    // A declarative hero is shares of one chart's last values, so it waits for the data.
    hero.innerHTML = heroThesis(meta, page, Object.fromEntries(specs.map((s, i) => [s.id, datas[i]])));
    typographize(hero);
  }

  const app = document.getElementById("app");
  app.textContent = "";
  let group = null, section = null;
  specs.forEach((spec, i) => {
    const byName = new Map(datas[i].series.map((s) => [s.name, s]));
    if (!(spec.series ?? [...byName.keys()]).some((n) => byName.has(n))) return;
    if (spec.group !== group) {
      group = spec.group;
      section = document.createElement("section");
      section.innerHTML = `<div class="section-head"><h2>${escapeHtml(group)}</h2></div>${sectionNote(page.groupNotes, group)}`;
      app.appendChild(section);
    }
    const card = document.createElement("figure");
    card.className = "card";
    card.innerHTML = `<figcaption><h3>${escapeHtml(spec.title)}</h3>${spec.note ? `<p>${escapeHtml(spec.note)}</p>` : ""}</figcaption><div class="canvas-wrap"><canvas></canvas></div>`;
    section.appendChild(card);
    const canvas = card.querySelector("canvas");
    const b = spec.selfBounds ? (seriesBounds(byName) || bounds) : bounds;
    if (spec.kind === "share") { if (spec.toggle) toggleShareChart(card, canvas, spec, byName, b); else shareChart(canvas, spec, byName, b); }
    else if (spec.kind === "versions") versionsChart(canvas, spec, byName, b);
    else if (spec.kind === "coverage") coverageChart(card, canvas, spec, byName, b);
    else if (spec.kind === "migration") migrationChart(card, canvas, spec, byName, b);
    else if (spec.kind === "bar") { if (spec.toggle) toggleBarChart(card, canvas, spec, byName); else barChart(canvas, spec, byName); }
    else lineChart(canvas, spec, byName, b);
  });
  // Typography the sections in the same synchronous task as the render, so the
  // text is final before paint — no reflow once the charts come in.
  typographize(app);
  rangePicker(bounds);
}

// --- roadmap modals (board + per-task dialogs are built into index.html at
// deploy from roadmap/*.json; here we only wire click → showModal) -------------

function wireRoadmap() {
  for (const btn of document.querySelectorAll(".card-item[data-dialog]")) {
    const dlg = document.getElementById(btn.dataset.dialog);
    if (!dlg) continue;
    btn.addEventListener("click", () => dlg.showModal());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
}

// Footer easter egg — tap the dodo for a random one-liner from phrases.json.
function wireDodo() {
  const dodo = document.getElementById("dodo-egg");
  const bubble = document.getElementById("dodo-bubble");
  if (!dodo || !bubble || !phrases.length) return;
  let last = -1;
  let hideTimer;
  dodo.addEventListener("click", () => {
    let i = Math.floor(Math.random() * phrases.length);
    if (phrases.length > 1 && i === last) i = (i + 1) % phrases.length; // no repeat in a row
    last = i;
    bubble.textContent = typo(phrases[i]);
    bubble.classList.remove("show");
    void bubble.offsetWidth; // reflow so re-adding replays the pop on every tap
    bubble.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bubble.classList.remove("show"), 4000);
  });
}

wireRoadmap();
wireDodo();
// The static content (roadmap, header) is in the DOM now — typography it before
// the async render, so it doesn't reflow when the charts arrive. Hero and
// sections are typographed inside main() at insertion time.
typographize(document.body);
main().catch((e) => { document.getElementById("app").textContent = `Failed to load metrics: ${e}`; });
