const SEND_TYPES = new Set(["rp", "f", "os"]);
const TYPE_LABELS = { rp: "Redpoint", f: "Flash", os: "Onsight", go: "Attempt" };
const ROUTE_GRADES = ["3", "3+", "4", "4+", "5", "5+", "5a", "5a+", "5b", "5b+", "5c", "5c+", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a", "7a+", "7b", "7b+", "7c", "7c+", "8a", "8a+"];
const BOULDER_GRADES = ["3", "3+", "4", "4+", "5A", "5A+", "5B", "5B+", "5C", "5C+", "6A", "6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A"];
const COUNTRY_NAMES = { BE: "Belgium", DE: "Germany", ES: "Spain", FR: "France" };

const state = {
  rows: [],
  period: "all",
  gear: "ROUTE",
  crag: "all",
  sendsOnly: false,
  search: "",
  sort: "date",
  direction: "desc",
};

const icon = (name) => {
  const paths = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7h4"/>',
    map: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0V4ZM9 20h6M12 12v8M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
};

function parseCSV(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  if (quoted) throw new Error("data.csv contains an unterminated quoted field.");
  if (records.length < 2) throw new Error("data.csv does not contain any climbing records.");

  const headers = records[0];
  const required = ["route_boulder", "name", "location_name", "date", "type", "difficulty"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`data.csv is missing required columns: ${missing.join(", ")}.`);

  return records.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`data.csv row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function filteredRows() {
  return state.rows.filter((row) =>
    row.route_boulder === state.gear &&
    (state.period === "all" || row.date.startsWith(state.period)) &&
    (state.crag === "all" || row.location_name === state.crag) &&
    (!state.sendsOnly || SEND_TYPES.has(row.type))
  );
}

function gradeIndex(grade) {
  const grades = state.gear === "ROUTE" ? ROUTE_GRADES : BOULDER_GRADES;
  const index = grades.indexOf(grade);
  return index === -1 ? -1 : index;
}

function metrics(rows) {
  const sends = rows.filter((row) => SEND_TYPES.has(row.type));
  const highestIndex = Math.max(-1, ...sends.map((row) => gradeIndex(row.difficulty)));
  const hardest = highestIndex < 0 ? "—" : (state.gear === "ROUTE" ? ROUTE_GRADES : BOULDER_GRADES)[highestIndex];
  const hardestRows = sends.filter((row) => row.difficulty === hardest);
  const efficient = sends.filter((row) => row.type === "f" || row.type === "os").length;
  return {
    ascents: rows.length,
    sends: sends.length,
    routes: new Set(rows.map((row) => row.name)).size,
    crags: new Set(rows.map((row) => row.location_name)).size,
    efficiency: sends.length ? Math.round((efficient / sends.length) * 100) : 0,
    hardest,
    hardestRows,
  };
}

function renderFilters() {
  const years = [...new Set(state.rows.map((row) => row.date.slice(0, 4)))].sort().reverse();
  const crags = [...new Set(state.rows.filter((row) => row.route_boulder === state.gear).map((row) => row.location_name))].sort((a, b) => a.localeCompare(b));
  if (state.crag !== "all" && !crags.includes(state.crag)) state.crag = "all";

  document.querySelector("#filters").innerHTML = `
    <label class="select-wrap">
      ${icon("calendar")}
      <select id="period-filter" aria-label="Period">
        <option value="all" ${state.period === "all" ? "selected" : ""}>All time</option>
        ${years.map((year) => `<option value="${year}" ${state.period === year ? "selected" : ""}>${year}</option>`).join("")}
      </select>
    </label>
    <label class="select-wrap">
      ${icon("activity")}
      <select id="gear-filter" aria-label="Climbing style">
        <option value="ROUTE" ${state.gear === "ROUTE" ? "selected" : ""}>Sport</option>
        <option value="BOULDER" ${state.gear === "BOULDER" ? "selected" : ""}>Boulder</option>
      </select>
    </label>
    <label class="select-wrap select-wrap--crag">
      ${icon("map")}
      <select id="crag-filter" aria-label="Crag">
        <option value="all">All crags</option>
        ${crags.map((crag) => `<option value="${escapeHTML(crag)}" ${state.crag === crag ? "selected" : ""}>${escapeHTML(crag)}</option>`).join("")}
      </select>
    </label>
    <label class="second-toggle">
      <input id="sends-filter" type="checkbox" ${state.sendsOnly ? "checked" : ""}>
      <span class="second-toggle__track" aria-hidden="true"><span></span></span>
      Sends only
    </label>`;

  document.querySelector("#period-filter").addEventListener("change", (event) => { state.period = event.target.value; render(); });
  document.querySelector("#gear-filter").addEventListener("change", (event) => { state.gear = event.target.value; state.crag = "all"; render(); });
  document.querySelector("#crag-filter").addEventListener("change", (event) => { state.crag = event.target.value; render(); });
  document.querySelector("#sends-filter").addEventListener("change", (event) => { state.sendsOnly = event.target.checked; render(); });
}

function lineChart(rows) {
  const groups = new Map();
  const allTime = state.period === "all";
  rows.forEach((row) => {
    const key = allTime ? row.date.slice(0, 4) : row.date.slice(0, 7);
    const current = groups.get(key) || { key, sends: 0, attempts: 0 };
    if (SEND_TYPES.has(row.type)) current.sends += 1;
    const tries = Number.parseInt(row.tries, 10);
    current.attempts += Number.isFinite(tries) ? Math.max(tries - (SEND_TYPES.has(row.type) ? 1 : 0), 0) : (SEND_TYPES.has(row.type) ? 0 : 1);
    groups.set(key, current);
  });
  const data = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (!data.length) return '<div class="empty-chart">No activity for these filters</div>';

  const width = 900;
  const height = 225;
  const pad = { left: 36, right: 14, top: 15, bottom: 27 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maximum = Math.max(1, ...data.flatMap((item) => [item.sends, item.attempts]));
  const x = (index) => pad.left + (data.length === 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
  const y = (value) => pad.top + innerHeight - (value / maximum) * innerHeight;
  const path = (field) => data.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(item[field]).toFixed(1)}`).join(" ");
  const area = `${path("sends")} L${x(data.length - 1)},${pad.top + innerHeight} L${x(0)},${pad.top + innerHeight} Z`;
  const grid = [0, .25, .5, .75, 1].map((part) => {
    const lineY = pad.top + innerHeight * part;
    const value = Math.round(maximum * (1 - part));
    return `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${lineY}" y2="${lineY}"/><text x="${pad.left - 8}" y="${lineY + 3}" text-anchor="end">${value}</text>`;
  }).join("");
  const step = Math.max(1, Math.ceil(data.length / 10));
  const labels = data.map((item, index) => {
    if (index % step && index !== data.length - 1) return "";
    const label = allTime ? item.key : new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${item.key}-01T00:00:00Z`));
    return `<text x="${x(index)}" y="${height - 7}" text-anchor="middle">${label}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sends and attempts over time">
    <defs><linearGradient id="sendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#74b9e8" stop-opacity=".5"/><stop offset="100%" stop-color="#74b9e8" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="area" d="${area}"/><path class="attempt-line" d="${path("attempts")}"/><path class="send-line" d="${path("sends")}"/>
    ${data.map((item, index) => `<circle class="point" cx="${x(index)}" cy="${y(item.sends)}" r="3"><title>${item.key}: ${item.sends} sends, ${item.attempts} attempts</title></circle>`).join("")}
    ${labels}
  </svg>`;
}

function gradeChart(rows) {
  const grades = state.gear === "ROUTE" ? ROUTE_GRADES : BOULDER_GRADES;
  const grouped = new Map();
  rows.filter((row) => SEND_TYPES.has(row.type)).forEach((row) => {
    const values = grouped.get(row.difficulty) || { rp: 0, f: 0, os: 0, other: 0 };
    if (row.type in values) values[row.type] += 1;
    else values.other += 1;
    grouped.set(row.difficulty, values);
  });
  const data = grades.filter((grade) => grouped.has(grade)).map((grade) => ({ grade, ...grouped.get(grade) }));
  if (!data.length) return '<div class="empty-chart">No sends for these filters</div>';

  const width = 700;
  const height = 225;
  const pad = { left: 34, right: 8, top: 15, bottom: 28 };
  const innerHeight = height - pad.top - pad.bottom;
  const maximum = Math.max(1, ...data.map((item) => item.rp + item.f + item.os + item.other));
  const slot = (width - pad.left - pad.right) / data.length;
  const barWidth = Math.min(30, slot * .62);
  const colors = { rp: "#173f68", other: "#8e9dad", os: "#579ac9", f: "#8fd1f4" };
  const grid = [0, .5, 1].map((part) => {
    const lineY = pad.top + innerHeight * part;
    return `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${lineY}" y2="${lineY}"/><text x="${pad.left - 8}" y="${lineY + 3}" text-anchor="end">${Math.round(maximum * (1 - part))}</text>`;
  }).join("");
  const bars = data.map((item, index) => {
    const center = pad.left + slot * index + slot / 2;
    let cursor = pad.top + innerHeight;
    const segments = ["rp", "other", "os", "f"].map((type) => {
      const segmentHeight = (item[type] / maximum) * innerHeight;
      cursor -= segmentHeight;
      return segmentHeight ? `<rect class="grade-segment" x="${center - barWidth / 2}" y="${cursor}" width="${barWidth}" height="${segmentHeight + .4}" fill="${colors[type]}"/>` : "";
    }).join("");
    const total = item.rp + item.f + item.os + item.other;
    const label = `${item.grade}: ${total} sends; ${item.f} flash, ${item.os} onsight, ${item.rp} redpoint, ${item.other} other`;
    return `<g class="grade-bar">${segments}<text x="${center}" y="${height - 8}" text-anchor="middle">${item.grade}</text><rect class="grade-hover" x="${center - slot / 2}" y="${pad.top}" width="${slot}" height="${innerHeight}" tabindex="0" role="img" aria-label="${label}" data-grade="${item.grade}" data-total="${total}" data-flash="${item.f}" data-onsight="${item.os}" data-redpoint="${item.rp}" data-other="${item.other}"/></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sends by grade and ascent style">${grid}${bars}</svg>`;
}

function favoriteCrags(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const current = grouped.get(row.location_name) || { name: row.location_name, ascents: 0, sends: 0 };
    current.ascents += 1;
    if (SEND_TYPES.has(row.type)) current.sends += 1;
    grouped.set(row.location_name, current);
  });
  return [...grouped.values()].sort((a, b) => b.ascents - a.ascents || a.name.localeCompare(b.name)).slice(0, 5);
}

function styleClass(type) {
  if (type === "os") return "tick tick--onsight";
  if (type === "f" || type === "rp") return "tick tick--clean";
  return "tick tick--working";
}

function setupGradeTooltip() {
  const chart = document.querySelector(".grade-panel .chart");
  const tooltip = document.querySelector("#grade-tooltip");
  if (!chart || !tooltip) return;

  const show = (target, clientX, clientY) => {
    tooltip.innerHTML = `
      <strong>${escapeHTML(target.dataset.grade)} <span>${target.dataset.total} sends</span></strong>
      <div><i class="legend__dot legend__dot--flash"></i>Flash <b>${target.dataset.flash}</b></div>
      <div><i class="legend__dot legend__dot--onsight"></i>Onsight <b>${target.dataset.onsight}</b></div>
      <div><i class="legend__dot legend__dot--redpoint"></i>Redpoint <b>${target.dataset.redpoint}</b></div>
      ${target.dataset.other !== "0" ? `<div><i class="legend__dot legend__dot--other"></i>Other <b>${target.dataset.other}</b></div>` : ""}`;
    tooltip.hidden = false;

    const chartBounds = chart.getBoundingClientRect();
    let left = clientX - chartBounds.left + 12;
    let top = clientY - chartBounds.top + 12;
    if (left + tooltip.offsetWidth > chartBounds.width - 6) left -= tooltip.offsetWidth + 24;
    if (top + tooltip.offsetHeight > chartBounds.height - 6) top -= tooltip.offsetHeight + 24;
    tooltip.style.left = `${Math.max(6, left)}px`;
    tooltip.style.top = `${Math.max(6, top)}px`;
  };
  const hide = () => { tooltip.hidden = true; };

  chart.querySelectorAll(".grade-hover").forEach((target) => {
    target.addEventListener("mouseenter", (event) => show(target, event.clientX, event.clientY));
    target.addEventListener("mousemove", (event) => show(target, event.clientX, event.clientY));
    target.addEventListener("mouseleave", hide);
    target.addEventListener("focus", () => {
      const bounds = target.getBoundingClientRect();
      show(target, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    });
    target.addEventListener("blur", hide);
  });
}

function sortedLogbook(rows) {
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => !query || [row.name, row.location_name, row.sector_name, row.comment, row.difficulty, TYPE_LABELS[row.type]].some((value) => value?.toLocaleLowerCase().includes(query)));
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const direction = state.direction === "asc" ? 1 : -1;
  return filtered.sort((left, right) => {
    let comparison = 0;
    if (state.sort === "name") comparison = collator.compare(left.name, right.name);
    else if (state.sort === "grade") comparison = gradeIndex(left.difficulty) - gradeIndex(right.difficulty);
    else if (state.sort === "location") comparison = collator.compare(`${left.location_name} ${left.sector_name}`, `${right.location_name} ${right.sector_name}`);
    else comparison = left.date.localeCompare(right.date);
    return comparison * direction || right.date.localeCompare(left.date);
  });
}

function sortHeader(field, label) {
  const arrow = state.sort === field ? (state.direction === "asc" ? " ↑" : " ↓") : "";
  return `<button class="sort-button" type="button" data-sort="${field}">${label}${arrow}</button>`;
}

function renderDashboard(rows, summary) {
  const hardestDetails = summary.hardestRows.slice(0, 2).map((row) => row.name).join(" · ");
  const favorites = favoriteCrags(rows);
  const countries = [...new Set(rows.map((row) => row.country_code))].sort();
  const logbook = sortedLogbook([...rows]);
  const countryCounts = Object.entries(rows.reduce((counts, row) => {
    counts[row.country_code] = (counts[row.country_code] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);

  document.querySelector("#dashboard").innerHTML = `
    <section class="metrics-grid" id="overview">
      <article class="metric-card metric-card--hero">
        <div class="metric-card__top"><span class="icon-box">${icon("trophy")}</span><span class="metric-kicker">Hardest send</span></div>
        <div><strong class="hero-grade">${escapeHTML(summary.hardest)}</strong><span class="hero-grade__label">${state.gear === "ROUTE" ? "French grade" : "Boulder grade"}</span></div>
        <div class="metric-card__footer"><strong>${summary.hardestRows.length ? `${summary.hardestRows.length} ascent${summary.hardestRows.length === 1 ? "" : "s"} at this grade` : "No sends for these filters"}</strong><span>${escapeHTML(hardestDetails)}</span></div>
      </article>
      <article class="metric-card">
        <div class="metric-card__top"><span class="icon-box icon-box--soft">${icon("activity")}</span><span class="metric-kicker">Logged ascents</span></div>
        <strong class="metric-value">${summary.ascents.toLocaleString()}</strong>
        <p>${summary.routes} unique routes explored across ${summary.crags} crags</p>
        <div class="metric-progress"><span style="width:${summary.ascents ? Math.round((summary.sends / summary.ascents) * 100) : 0}%"></span></div>
        <div class="ascent-summary">
          <span><strong>${summary.sends}</strong><small>successful sends</small></span>
          <span><strong>${summary.efficiency}%</strong><small>flash / onsight efficiency</small></span>
        </div>
      </article>
    </section>

    <section class="dashboard-grid" id="performance">
      <article class="panel panel--wide rhythm-panel">
        <div class="panel__header"><div><span class="panel__eyebrow">Momentum</span><h2>Climbing rhythm</h2></div><div class="legend"><span><i class="legend__dot legend__dot--send"></i>Sends</span><span><i class="legend__dot legend__dot--attempt"></i>Attempts</span></div></div>
        <div class="chart chart--area">${lineChart(rows)}</div>
      </article>
      <article class="panel panel--wide grade-panel">
        <div class="panel__header"><div><span class="panel__eyebrow">Send pyramid</span><h2>Grade distribution</h2></div><div class="grade-legend"><span><i class="legend__dot legend__dot--flash"></i>Flash</span><span><i class="legend__dot legend__dot--onsight"></i>Onsight</span><span><i class="legend__dot legend__dot--redpoint"></i>Redpoint</span></div></div>
        <div class="chart chart--bars">${gradeChart(rows)}<div class="chart-tooltip" id="grade-tooltip" role="tooltip" hidden></div></div>
      </article>
      <article class="panel places-panel">
        <div class="panel__header"><div><span class="panel__eyebrow">${summary.crags} places explored</span><h2>Favorite crags</h2></div><a class="panel__meta" href="#places">View places</a></div>
        <div class="crag-list">
          ${favorites.length ? favorites.map((crag, index) => `<button class="crag-row" type="button" data-crag="${escapeHTML(crag.name)}"><span class="crag-row__rank">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHTML(crag.name)}</strong><small>${crag.sends} sends · filter logbook</small></div><span class="crag-row__count">${crag.ascents}</span></button>`).join("") : '<div class="empty-chart">No crags for these filters</div>'}
        </div>
        <div class="country-strip">${countries.map((code) => `<span class="country-chip">${escapeHTML(COUNTRY_NAMES[code] || code)}</span>`).join("")}</div>
      </article>
    </section>

    <section class="panel logbook-panel" id="logbook">
      <div class="panel__header logbook-header">
        <div><span class="panel__eyebrow">${logbook.length} ascents</span><h2>Logbook</h2></div>
        <div class="logbook-actions">
          <label class="search-box">${icon("search")}<input id="logbook-search" value="${escapeHTML(state.search)}" placeholder="Search climbs or crags" aria-label="Search climbs or crags"></label>
          <button class="icon-button" id="export-button" type="button" title="Export filtered summary" aria-label="Export filtered summary">${icon("download")}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${sortHeader("name", "Route")}</th><th>${sortHeader("grade", "Grade")}</th><th>Style</th><th>${sortHeader("location", "Location")}</th><th>Comment</th><th>${sortHeader("date", "Date")}</th></tr></thead>
          <tbody>
            ${logbook.map((row) => `<tr>
              <td><strong>${escapeHTML(row.name)}</strong><small>${state.gear === "ROUTE" ? "Sport" : "Boulder"}</small></td>
              <td><span class="grade-pill">${escapeHTML(row.difficulty)}</span></td>
              <td><span class="${styleClass(row.type)}">${escapeHTML(TYPE_LABELS[row.type] || row.type)}</span>${row.type === "rp" ? `<small class="attempt-count">${row.tries === "null" ? "—" : escapeHTML(row.tries)} attempts</small>` : ""}</td>
              <td><span class="table-location">${icon("map")}<span><strong>${escapeHTML(row.location_name)}</strong>${row.sector_name && row.sector_name !== row.location_name ? `<small>${escapeHTML(row.sector_name)}</small>` : ""}</span></span></td>
              <td class="table-comment" title="${escapeHTML(row.comment)}">${escapeHTML(row.comment || "—")}</td>
              <td><span class="table-date">${icon("calendar")}${formatDate(row.date)}</span></td>
            </tr>`).join("") || '<tr><td colspan="6">No ascents match these filters.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel geography-panel" id="places">
      <div class="panel__header"><div><span class="panel__eyebrow">Climbing geography</span><h2>Places you’ve climbed</h2></div><span class="panel__meta">${state.gear === "ROUTE" ? "Sport" : "Boulder"} · ${state.period === "all" ? "all time" : state.period}</span></div>
      <div class="geography-grid">${countryCounts.map(([code, count]) => `<div class="country-card"><strong>${count}</strong><span>${escapeHTML(COUNTRY_NAMES[code] || code)} ascents</span></div>`).join("") || '<div class="empty-chart">No location data</div>'}</div>
    </section>`;

  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    const field = button.dataset.sort;
    if (state.sort === field) state.direction = state.direction === "asc" ? "desc" : "asc";
    else { state.sort = field; state.direction = field === "date" ? "desc" : "asc"; }
    render();
  }));
  document.querySelectorAll("[data-crag]").forEach((button) => button.addEventListener("click", () => {
    state.crag = button.dataset.crag;
    render();
    document.querySelector("#logbook").scrollIntoView({ behavior: "smooth" });
  }));
  document.querySelector("#logbook-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render(true);
  });
  document.querySelector("#export-button").addEventListener("click", () => exportSummary(rows, summary));
  setupGradeTooltip();
}

function exportSummary(rows, summary) {
  const data = JSON.stringify({
    filters: { period: state.period, style: state.gear === "ROUTE" ? "Sport" : "Boulder", crag: state.crag, sendsOnly: state.sendsOnly },
    summary,
    ascents: rows,
  }, (key, value) => key === "hardestRows" ? undefined : value, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "climbing-summary.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function render(refocusSearch = false) {
  renderFilters();
  const rows = filteredRows();
  const summary = metrics(rows);
  renderDashboard(rows, summary);
  document.querySelector("#footer-count").textContent = `${state.rows.length.toLocaleString()} records · local data.csv`;
  if (refocusSearch) {
    const input = document.querySelector("#logbook-search");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

async function start() {
  try {
    const response = await fetch("data.csv");
    if (!response.ok) throw new Error(`Could not load data.csv (${response.status}).`);
    state.rows = parseCSV(await response.text());
    const latest = state.rows.reduce((date, row) => row.date > date ? row.date : date, "");
    document.querySelector("#source-note").innerHTML = `<span class="source-note__dot"></span>${state.rows.length.toLocaleString()} records loaded · data through ${formatDate(latest)}`;
    render();
  } catch (error) {
    document.querySelector("#source-note").innerHTML = `<span class="source-note__dot"></span>Could not load data`;
    document.querySelector("#dashboard").innerHTML = `<p class="error"><strong>Dashboard unavailable.</strong><br>${escapeHTML(error.message)} Run this site through a local web server rather than opening index.html directly.</p>`;
    console.error(error);
  }
}

start();
