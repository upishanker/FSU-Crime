/* ============================================================
   FSU Crime Log — front-end application
   ============================================================ */
(function () {
  "use strict";

  const FSU_CENTER = [30.4419, -84.2985];
  const PAGE_SIZE = 25;

  // Category rules — first matching pattern wins (order matters).
  const CATEGORY_RULES = [
    ["Homicide",        /homicid|murder|manslaughter|\bdeath\b/i],
    ["Sex Offense",     /sex|rape|lewd|voyeur|indecent|fondl/i],
    ["Assault / Battery",/batter|assault|aggravat|stalk|domestic viol/i],
    ["Weapons",         /weapon|firearm|\bgun\b|discharg/i],
    ["Robbery",         /robbery/i],
    ["Burglary",        /burglar/i],
    ["Theft",           /theft|larceny|stolen|steal|shoplift|retail|pickpocket/i],
    ["Fraud / Financial",/fraud|forge|counterfeit|identity|credit card|embezzl|worthless check|scheme/i],
    ["DUI / Alcohol",   /\bdui\b|\bdwi\b|alcohol|intoxicat|open container|underage/i],
    ["Drugs",           /drug|narcotic|cannabis|marijuana|cocaine|controlled substance|paraphernalia|possess.*subst/i],
    ["Trespass",        /trespass/i],
    ["Vandalism",       /vandal|criminal mischief|damage to|graffiti/i],
    ["Traffic",         /traffic|driv|licen|registration|speeding|reckless|\btag\b|dwlsr|motor veh|\blamp|does not contain/i],
    ["Public Order",    /disorder|disturb|noise|loiter|resist|obstruct|false info|fail.*appear|contempt|injunction|violation of/i],
    ["Fire / Arson",    /arson|\bfire\b/i],
  ];
  const OTHER = "Other";

  // Warm, cohesive categorical palette (garnet/gold family).
  const PALETTE = [
    "#a4283c", "#d9b45f", "#c9683f", "#4c8b83", "#7a4b6b", "#8a9a5b",
    "#6b7a8f", "#b79b6e", "#b4566b", "#5f7a52", "#9e5b34", "#8a6a9a",
    "#3f7d8b", "#c08a3e", "#7d5a4f", "#96795b",
  ];

  function categorize(type) {
    if (!type) return OTHER;
    for (const [name, re] of CATEGORY_RULES) if (re.test(type)) return name;
    return OTHER;
  }

  // ---- state ----
  const state = {
    all: [],
    view: "map",
    search: "",
    dateFrom: null,
    dateTo: null,
    categories: new Set(),   // empty = all
    dispositions: new Set(), // empty = all
    sort: { key: "crime_date", dir: "desc" },
    page: 1,
    basemap: "detailed",     // "detailed" (OSM) | "minimal" (CARTO)
  };
  const catColor = {};       // category -> color
  let map, cluster, tileLayer, basemapEl;
  const charts = {};
  let statsDirty = true;

  // Basemap tile sources. "detailed" keeps building names (OSM); "minimal" uses
  // CARTO Positron / Dark Matter, following the light/dark UI theme.
  const TILES = {
    detailed: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    minimalLight: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", subdomains: "abcd",
      attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    minimalDark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", subdomains: "abcd",
      attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---- helpers ----
  const parseDate = (iso) => (iso ? new Date(iso) : null);
  function fmtDate(iso) {
    const d = parseDate(iso);
    if (!d || isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const dispClass = (d) => {
    d = (d || "").toLowerCase();
    if (d.includes("arrest") || d.includes("citation") || d.includes("cleared")) return "badge--cleared";
    if (d.includes("open") || d.includes("pending")) return "badge--open";
    return "badge--inactive";
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ============================================================
  //  LOAD
  // ============================================================
  fetch("data/crimes.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch((err) => {
      console.error("Failed to load crime data:", err);
      $("#load-error").hidden = false;
    });

  function init(payload) {
    // enrich
    state.all = (payload.crimes || []).map((c) => ({
      ...c,
      category: categorize(c.crime_type),
      _date: parseDate(c.crime_date),
    }));
    // assign category colors by frequency (most common -> first palette slots)
    const freq = countBy(state.all, "category");
    Object.keys(freq).sort((a, b) => freq[b] - freq[a]).forEach((cat, i) => {
      catColor[cat] = PALETTE[i % PALETTE.length];
    });

    // header meta
    if (payload.generated_at) {
      const g = new Date(payload.generated_at);
      $("#updated-at").textContent = g.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      $("#updated-at").dateTime = payload.generated_at;
    }
    $("#footer-total").textContent =
      `${payload.total_records ?? state.all.length} records · ${payload.count ?? "?"} mapped`;

    buildFilterUI(freq);
    wireEvents();
    initMap();
    render();
  }

  function countBy(arr, key) {
    return arr.reduce((m, x) => { const k = x[key] || "—"; m[k] = (m[k] || 0) + 1; return m; }, {});
  }

  // ============================================================
  //  FILTER UI
  // ============================================================
  function buildFilterUI(catFreq) {
    // categories
    const catBox = $("#category-list");
    catBox.innerHTML = "";
    Object.keys(catFreq).sort((a, b) => catFreq[b] - catFreq[a]).forEach((cat) => {
      catBox.appendChild(checkItem("category", cat, catFreq[cat], catColor[cat]));
    });

    // dispositions
    const dispFreq = countBy(state.all, "disposition");
    const dispBox = $("#disposition-list");
    dispBox.innerHTML = "";
    Object.keys(dispFreq).sort((a, b) => dispFreq[b] - dispFreq[a]).forEach((d) => {
      dispBox.appendChild(checkItem("disposition", d || "—", dispFreq[d], null));
    });
  }

  function checkItem(group, value, count, color) {
    const el = document.createElement("label");
    el.className = "check-item";
    el.innerHTML =
      `<input type="checkbox" value="${escapeAttr(value)}" data-group="${group}">` +
      (color ? `<span class="swatch" style="background:${color}"></span>` : "") +
      `<span class="lbl" title="${escapeAttr(value)}">${escapeHtml(value)}</span>` +
      `<span class="cnt">${count}</span>`;
    return el;
  }

  // ============================================================
  //  EVENTS
  // ============================================================
  function wireEvents() {
    $("#search").addEventListener("input", debounce((e) => {
      state.search = e.target.value.trim().toLowerCase();
      state.page = 1; render();
    }, 180));

    document.addEventListener("change", (e) => {
      const cb = e.target;
      if (cb.matches('input[data-group]')) {
        const set = cb.dataset.group === "category" ? state.categories : state.dispositions;
        cb.checked ? set.add(cb.value) : set.delete(cb.value);
        updateBadges();
        state.page = 1; render();
      }
    });

    $("#date-from").addEventListener("change", (e) => { state.dateFrom = e.target.value || null; clearPreset(); state.page = 1; render(); });
    $("#date-to").addEventListener("change", (e) => { state.dateTo = e.target.value || null; clearPreset(); state.page = 1; render(); });

    $("#date-presets").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip"); if (!btn) return;
      $$("#date-presets .chip").forEach((c) => c.classList.remove("is-active"));
      btn.classList.add("is-active");
      const days = btn.dataset.days;
      if (days === "all") { state.dateFrom = state.dateTo = null; }
      else {
        const to = new Date(); const from = new Date(); from.setDate(from.getDate() - (+days));
        state.dateFrom = iso(from); state.dateTo = iso(to);
      }
      $("#date-from").value = state.dateFrom || "";
      $("#date-to").value = state.dateTo || "";
      state.page = 1; render();
    });

    $("#reset-filters").addEventListener("click", resetFilters);

    $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

    $$(".crime-table thead th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key, dir: key === "crime_date" ? "desc" : "asc" };
      renderList();
    }));

    $("#page-prev").addEventListener("click", () => { if (state.page > 1) { state.page--; renderList(); } });
    $("#page-next").addEventListener("click", () => { state.page++; renderList(); });

    $("#theme-toggle").addEventListener("click", toggleTheme);

    // filter dropdowns (category / disposition)
    $$(".dropdown .fb-btn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dd = btn.closest(".dropdown");
      const open = dd.classList.contains("is-open");
      $$(".dropdown").forEach((d) => { d.classList.remove("is-open"); d.querySelector(".fb-btn").setAttribute("aria-expanded", "false"); });
      if (!open) { dd.classList.add("is-open"); btn.setAttribute("aria-expanded", "true"); }
    }));
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown"))
        $$(".dropdown.is-open").forEach((d) => { d.classList.remove("is-open"); d.querySelector(".fb-btn").setAttribute("aria-expanded", "false"); });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $$(".dropdown.is-open").forEach((d) => d.classList.remove("is-open"));
    });
  }

  function updateBadges() {
    const set = (el, n) => { el.hidden = n === 0; el.textContent = n; };
    set($("#cat-badge"), state.categories.size);
    set($("#disp-badge"), state.dispositions.size);
  }

  function clearPreset() { $$("#date-presets .chip").forEach((c) => c.classList.remove("is-active")); }

  function resetFilters() {
    state.search = ""; state.dateFrom = state.dateTo = null;
    state.categories.clear(); state.dispositions.clear(); state.page = 1;
    $("#search").value = "";
    $("#date-from").value = ""; $("#date-to").value = "";
    $$('input[data-group]').forEach((c) => (c.checked = false));
    clearPreset(); $('#date-presets .chip[data-days="all"]').classList.add("is-active");
    updateBadges();
    render();
  }

  // ============================================================
  //  FILTERING
  // ============================================================
  function filtered() {
    const { search, dateFrom, dateTo, categories, dispositions } = state;
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;
    return state.all.filter((c) => {
      if (categories.size && !categories.has(c.category)) return false;
      if (dispositions.size && !dispositions.has(c.disposition || "—")) return false;
      if (from && (!c._date || c._date < from)) return false;
      if (to && (!c._date || c._date > to)) return false;
      if (search) {
        const hay = (c.crime_type + " " + c.location + " " + c.report_number + " " + c.disposition).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    const data = filtered();
    const mapped = data.filter((c) => c.latitude != null && c.longitude != null);
    $("#result-n").textContent = data.length.toLocaleString();
    const unmapped = data.length - mapped.length;
    $("#unmapped-note").textContent = unmapped ? `· ${unmapped} without a mapped location` : "";

    renderMap(mapped);
    renderList(data);
    statsDirty = true;
    if (state.view === "stats") renderStats(data);
  }

  function switchView(view) {
    state.view = view;
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
    if (view === "map" && map) setTimeout(() => map.invalidateSize(), 60);
    if (view === "stats") renderStats(filtered());
  }

  // ---- MAP ----
  function initMap() {
    map = L.map("map", { zoomControl: true, scrollWheelZoom: true }).setView(FSU_CENTER, 14);
    setTiles();
    cluster = L.markerClusterGroup({
      maxClusterRadius: 46,
      iconCreateFunction: (cl) => {
        const n = cl.getChildCount();
        const size = n < 10 ? 34 : n < 50 ? 42 : 52;
        return L.divIcon({
          html: `<div class="cluster-ico" style="width:${size}px;height:${size}px">${n}</div>`,
          className: "", iconSize: [size, size],
        });
      },
    });
    map.addLayer(cluster);
    addBasemapControl();
  }

  function currentTileCfg() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (state.basemap === "minimal") return dark ? TILES.minimalDark : TILES.minimalLight;
    // "detailed" uses one OSM layer for both themes; dark is done via CSS filter.
    return TILES.detailed;
  }

  function setTiles() {
    const cfg = currentTileCfg();
    if (tileLayer && tileLayer._url === cfg.url) return; // nothing to swap
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution, subdomains: cfg.subdomains, maxZoom: 19,
    }).addTo(map);
  }

  function setBasemap(bm) {
    state.basemap = bm === "minimal" ? "minimal" : "detailed";
    document.documentElement.dataset.basemap = state.basemap;
    try { localStorage.setItem("fsu-basemap", state.basemap); } catch (e) {}
    setTiles();
    syncBasemapButtons();
  }

  function addBasemapControl() {
    const Ctl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const div = L.DomUtil.create("div", "basemap-switch");
        div.setAttribute("role", "group");
        div.setAttribute("aria-label", "Map style");
        div.innerHTML =
          `<button type="button" data-bm="detailed" title="Detailed streets & building names (OpenStreetMap)">Detailed</button>` +
          `<button type="button" data-bm="minimal" title="Minimal basemap (CARTO Positron / Dark Matter)">Minimal</button>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div, "click", (e) => {
          const b = e.target.closest("button");
          if (b) setBasemap(b.dataset.bm);
        });
        basemapEl = div;
        return div;
      },
    });
    map.addControl(new Ctl());
    syncBasemapButtons();
  }

  function syncBasemapButtons() {
    if (!basemapEl) return;
    basemapEl.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.bm === state.basemap));
  }

  function renderMap(data) {
    if (!cluster) return;
    cluster.clearLayers();
    const markers = data.map((c) => {
      const color = catColor[c.category] || PALETTE[0];
      const m = L.marker([c.latitude, c.longitude], {
        icon: L.divIcon({
          className: "",
          html: `<div class="pin" style="background:${color}"></div>`,
          iconSize: [16, 16], iconAnchor: [8, 16], popupAnchor: [0, -14],
        }),
      });
      m.bindPopup(popupHtml(c), { maxWidth: 300 });
      return m;
    });
    cluster.addLayers(markers);
  }

  function popupHtml(c) {
    const color = catColor[c.category] || PALETTE[0];
    return `
      <span class="cat-chip"><span class="dot" style="background:${color}"></span>${escapeHtml(c.category)}</span>
      <div class="pop__type">${escapeHtml(c.crime_type || "Unknown offense")}</div>
      <div class="pop__row"><b>When</b><span>${fmtDate(c.crime_date)}</span></div>
      <div class="pop__row"><b>Where</b><span>${escapeHtml(c.location || "—")}</span></div>
      <div class="pop__row"><b>Status</b><span class="badge ${dispClass(c.disposition)}">${escapeHtml(c.disposition || "—")}</span></div>
      <div class="pop__row"><b>Report</b><span>${escapeHtml(c.report_number || "—")}</span></div>`;
  }

  // ---- LIST ----
  function renderList(data) {
    data = data || filtered();
    const { key, dir } = state.sort;
    const mul = dir === "asc" ? 1 : -1;
    const sorted = [...data].sort((a, b) => {
      let av = key === "crime_date" ? (a._date ? a._date.getTime() : -Infinity) : (a[key] || "").toLowerCase();
      let bv = key === "crime_date" ? (b._date ? b._date.getTime() : -Infinity) : (b[key] || "").toLowerCase();
      return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
    });

    const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const rows = sorted.slice(start, start + PAGE_SIZE);

    const body = $("#table-body");
    if (!rows.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="5">No incidents match these filters.</td></tr>`;
    } else {
      body.innerHTML = rows.map((c) => {
        const color = catColor[c.category] || PALETTE[0];
        return `<tr data-lat="${c.latitude ?? ""}" data-lon="${c.longitude ?? ""}">
          <td class="td-date">${fmtDate(c.crime_date)}</td>
          <td><span class="cat-chip"><span class="dot" style="background:${color}"></span>${escapeHtml(c.category)}</span></td>
          <td class="td-type">${escapeHtml(c.crime_type || "—")}</td>
          <td class="td-loc">${escapeHtml(c.location || "—")}</td>
          <td><span class="badge ${dispClass(c.disposition)}">${escapeHtml(c.disposition || "—")}</span></td>
        </tr>`;
      }).join("");
      $$("#table-body tr").forEach((tr) => tr.addEventListener("click", () => {
        const lat = tr.dataset.lat, lon = tr.dataset.lon;
        if (lat && lon) { switchView("map"); setTimeout(() => map.setView([+lat, +lon], 17), 120); }
      }));
    }

    $$(".crime-table thead th[data-sort]").forEach((th) => {
      th.classList.remove("is-sorted-asc", "is-sorted-desc");
      if (th.dataset.sort === key) th.classList.add(dir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
    });
    $("#page-info").textContent = `Page ${state.page} of ${pages} · ${sorted.length.toLocaleString()} incidents`;
    $("#page-prev").disabled = state.page <= 1;
    $("#page-next").disabled = state.page >= pages;
  }

  // ---- STATS ----
  function renderStats(data) {
    data = data || filtered();
    if (typeof Chart === "undefined") { setTimeout(() => renderStats(data), 120); return; }
    renderKPIs(data);

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink").trim();
    const dim = css.getPropertyValue("--ink-faint").trim();
    const grid = css.getPropertyValue("--line-soft").trim();
    Chart.defaults.color = dim;
    Chart.defaults.font.family = "JetBrains Mono, monospace";

    // by category (sorted desc)
    const catFreq = countBy(data, "category");
    const catLabels = Object.keys(catFreq).sort((a, b) => catFreq[b] - catFreq[a]);
    upsertChart("chart-category", {
      type: "bar",
      data: {
        labels: catLabels,
        datasets: [{
          data: catLabels.map((c) => catFreq[c]),
          backgroundColor: catLabels.map((c) => catColor[c] || PALETTE[0]),
          borderRadius: 5, borderSkipped: false,
        }],
      },
      options: baseOpts({ indexAxis: "y", grid, ink }),
    });

    // disposition donut
    const dFreq = countBy(data, "disposition");
    const dLabels = Object.keys(dFreq).sort((a, b) => dFreq[b] - dFreq[a]);
    upsertChart("chart-disposition", {
      type: "doughnut",
      data: {
        labels: dLabels,
        datasets: [{
          data: dLabels.map((d) => dFreq[d]),
          backgroundColor: dLabels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor: css.getPropertyValue("--panel").trim(), borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: { legend: { position: "right", labels: { boxWidth: 10, padding: 10, font: { size: 11 } } } },
      },
    });

    // timeline by month
    const months = {};
    data.forEach((c) => { if (c.crime_date) { const m = c.crime_date.slice(0, 7); months[m] = (months[m] || 0) + 1; } });
    const mKeys = Object.keys(months).sort();
    upsertChart("chart-timeline", {
      type: "line",
      data: {
        labels: mKeys.map(monthLabel),
        datasets: [{
          data: mKeys.map((m) => months[m]),
          borderColor: css.getPropertyValue("--gold").trim(),
          backgroundColor: "rgba(217,180,95,.15)",
          fill: true, tension: .32, pointRadius: 3,
          pointBackgroundColor: css.getPropertyValue("--garnet").trim(),
        }],
      },
      options: baseOpts({ grid, ink }),
    });
    statsDirty = false;
  }

  function baseOpts({ indexAxis, grid, ink }) {
    return {
      indexAxis: indexAxis || "x",
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { font: { size: 11 } } },
      },
    };
  }

  function upsertChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($("#" + id), config);
  }

  function renderKPIs(data) {
    const mapped = data.filter((c) => c.latitude != null).length;
    const catFreq = countBy(data, "category");
    const topCat = Object.keys(catFreq).sort((a, b) => catFreq[b] - catFreq[a])[0] || "—";
    const dates = data.map((c) => c._date).filter(Boolean).sort((a, b) => a - b);
    const span = dates.length
      ? `${dates[0].toLocaleDateString("en-US", { month: "short", year: "2-digit" })} – ${dates[dates.length - 1].toLocaleDateString("en-US", { month: "short", year: "2-digit" })}`
      : "—";
    const cleared = data.filter((c) => dispClass(c.disposition) === "badge--cleared").length;
    const kpis = [
      { label: "Incidents", value: data.length.toLocaleString(), sub: `${mapped} mapped` },
      { label: "Categories", value: Object.keys(catFreq).length, sub: `top: ${topCat}` },
      { label: "Cleared", value: data.length ? Math.round((cleared / data.length) * 100) + "%" : "—", sub: `${cleared} resolved` },
      { label: "Date span", value: span, sub: `${dates.length} dated` },
    ];
    $("#kpi-row").innerHTML = kpis.map((k) => `
      <div class="card kpi">
        <div class="k-label">${k.label}</div>
        <div class="k-value">${k.value}</div>
        <div class="k-sub">${escapeHtml(k.sub)}</div>
      </div>`).join("");
  }

  // ---- THEME ----
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fsu-theme", next); } catch (e) {}
    if (map) setTiles();
    if (state.view === "stats") renderStats(filtered());
  }
  (function restoreTheme() {
    let saved; try { saved = localStorage.getItem("fsu-theme"); } catch (e) {}
    if (saved) document.documentElement.dataset.theme = saved;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches)
      document.documentElement.dataset.theme = "light";
  })();
  (function restoreBasemap() {
    let saved; try { saved = localStorage.getItem("fsu-basemap"); } catch (e) {}
    state.basemap = saved === "minimal" ? "minimal" : "detailed";
    document.documentElement.dataset.basemap = state.basemap;
  })();

  // ---- utils ----
  function iso(d) { return d.toISOString().slice(0, 10); }
  function monthLabel(m) {
    const [y, mo] = m.split("-");
    return new Date(+y, +mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }
})();
