"use strict";

const storageKey = "eod-reporting-desk-public-v1";
const $ = (id) => document.getElementById(id);
let storageIssue = false;
let state;
let date;
let active = "overall";
let noticeTimer;
let writes = Promise.resolve();
let storageMode = "browser";
let generating = false;

function persist() {
  pruneStoredDays();
  const payload = JSON.stringify(state);
  if (storageMode === "browser") {
    try {
      localStorage.setItem(storageKey, payload);
      return Promise.resolve(true);
    } catch {
      notify("This browser could not save your changes. Copy your report before leaving.");
      return Promise.resolve(false);
    }
  }
  writes = writes.then(async () => {
    try {
      const response = await fetch("/api/state", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: payload
      });
      if (!response.ok) throw new Error("Save failed");
      return true;
    } catch {
      notify("Could not save to SQLite. Keep this page open and try again.");
      return false;
    }
  });
  return writes;
}

function notify(message) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = false;
  noticeTimer = setTimeout(() => { $("notice").hidden = true; }, 4300);
}

function reportDate(now = new Date()) {
  const timeZone = state.settings.zone === "local" ? undefined : state.settings.zone;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return [fields.year, fields.month, fields.day].join("-");
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
  }).format(new Date(value + "T00:00:00Z"));
}

function draft() {
  return state.drafts[date] ??= structuredClone(state.history[date]?.draft ?? { raw: "", updates: [] });
}

function normalizeProject(value) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function projectMention(line, project) {
  const pattern = project.trim().split(/\s+/).map((part) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("[\\s_-]*");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + pattern + "(?=$|[^\\p{L}\\p{N}])", "iu").test(line);
}

function polishUpdate(value) {
  let text = value.replace(/\s+/g, " ").trim();
  text = text.replace(/^i\s+(?=(?:completed|finished|fixed|resolved|implemented|tested|reviewed|updated|created|added|submitted|worked)\b)/i, "").replace(/^i've\s+/i, "I have ");
  if (!text) return "";
  text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : text + ".";
}

function parseUpdates(text, projects = []) {
  const heading = /^(completed(?: work| tasks| updates)?|done|pending(?: tasks| work)?|upcoming tasks|next steps|in progress|work updates|blockers?)$/i;
  const updates = [];
  let groupStatus = "";
  for (const rawLine of text.split(/\r?\n|;\s*|(?<=[.!?])\s+(?=[A-Za-z])/)) {
    let task = rawLine.trim().replace(/^(?:[-*\u2022\u2013]\s+|\d+[.)]\s+)/u, "");
    if (!task) continue;
    const label = task.replace(/:\s*$/, "").trim();
    if (heading.test(label)) {
      groupStatus = /^(completed|done)/i.test(label) ? "completed"
        : /^(pending|upcoming|next|in progress|block)/i.test(label) ? "pending" : "update";
      continue;
    }
    let status = groupStatus;
    const statusPrefix = task.match(/^(completed|done|pending|in progress|upcoming|blocked)\s*:\s*(.+)$/i);
    if (statusPrefix) {
      status = /^(completed|done)$/i.test(statusPrefix[1]) ? "completed" : "pending";
      if (!/^blocked$/i.test(statusPrefix[1])) task = statusPrefix[2];
    }
    if (/\b(not yet|not completed|not done|incomplete|pending|blocked|blocker|in progress|ongoing|tomorrow|need to|still need|to do|plan to|will|waiting|awaiting)\b/i.test(task)) {
      status = "pending";
    }
    if (!status && /^(?:i\s+)?(?:completed|finished|fixed|resolved|implemented|delivered|deployed|tested|reviewed|updated|created|added|removed|submitted|merged)\b/i.test(task)) status = "completed";
    const prefix = task.match(/^([^:]+):\s*(.+)$/);
    const explicit = prefix && projects.find((name) => normalizeProject(name) === normalizeProject(prefix[1]));
    const general = prefix && /^(general|other)$/i.test(prefix[1].trim());
    const project = explicit || (!general && projects.find((name) => projectMention(task, name)));
    if (explicit || general) task = prefix[2];
    updates.push({ text: polishUpdate(task), status: status || "update", scope: project ? "project:" + project : "general" });
  }
  return updates;
}

function reportFor(type, updates, settings, reportDay) {
  const scoped = type === "project";
  const recipient = settings[type]?.trim() || "Team";
  const visible = scoped ? updates.filter((entry) => usedInProjectReport(entry, settings.projects)) : updates;
  if (!visible.length) return null;
  const usedProjects = settings.projects.filter((name) => visible.some((entry) => entry.scope === "project:" + name));
  const projectNames = usedProjects.join(" / ");
  const subject = "EOD Status Update - " + (scoped ? projectNames + " - " : "") + reportDay;
  const lines = ["Hi " + recipient + ",", "",
    scoped ? "Please find my end-of-day update for " + projectNames + " below."
      : "Please find my end-of-day work summary below.", "", "Date: " + reportDay];
  if (projectNames) lines.push("Projects: " + projectNames);
  for (const [status, title] of [["completed", "Completed Work"], ["update", "Work Updates"], ["pending", "In Progress / Next Steps"]]) {
    const entries = visible.filter((entry) => (entry.status || "update") === status);
    if (entries.length) lines.push("", title, "", ...entries.map((entry) => "\u2022 " + polishUpdate(entry.text)));
  }
  lines.push("", "Best regards,");
  if (settings.sender?.trim()) lines.push(settings.sender.trim());
  return { recipient, subject, message: lines.join("\n") };
}

function reportSignature() {
  return JSON.stringify([draft().raw, draft().updates, state.settings]);
}

function isStale() {
  return Boolean(draft().reports && draft().signature !== reportSignature());
}

function fillScope(select, selected) {
  select.add(new Option("Choose scope", ""));
  select.add(new Option("General / other", "general"));
  for (const name of state.settings.projects) select.add(new Option(name, "project:" + name));
  if (selected && !Array.from(select.options).some((option) => option.value === selected)) {
    select.add(new Option(selected.slice("project:".length) + " (removed)", selected));
  }
  select.value = selected;
}

function showUpdates() {
  const list = $("update-list");
  list.replaceChildren();
  const updates = draft().updates;
  for (const [index, entry] of updates.entries()) {
    const fragment = $("update-template").content.cloneNode(true);
    const row = fragment.firstElementChild;
    const task = row.querySelector(".task");
    const status = row.querySelector(".status");
    const scope = row.querySelector(".scope");
    task.value = entry.text;
    status.value = entry.status;
    status.dataset.status = entry.status;
    fillScope(scope, entry.scope);
    task.addEventListener("input", () => {
      entry.text = task.value;
      persist();
      refreshActions();
    });
    status.addEventListener("change", () => {
      entry.status = status.value;
      status.dataset.status = status.value;
      persist();
      refreshActions();
    });
    scope.addEventListener("change", () => {
      entry.scope = scope.value;
      persist();
      refreshActions();
    });
    row.querySelector(".remove").addEventListener("click", () => {
      updates.splice(index, 1);
      persist();
      showUpdates();
      refreshActions();
      ($("update-list").children[index]?.querySelector("textarea") ?? $("review")).focus();
    });
    list.append(fragment);
  }
  $("empty-list").hidden = Boolean(updates.length);
}

function usedInProjectReport(entry, projects) {
  return projects.some((project) => entry.scope === "project:" + project);
}

function unresolved(entry) {
  return !entry.text.trim() || !entry.status ||
    !(entry.scope === "general" || usedInProjectReport(entry, state.settings.projects));
}

function refreshSummary(updates, reviewed) {
  const total = updates.length;
  const completed = updates.filter((entry) => entry.text.trim() && entry.status === "completed").length;
  const pending = updates.filter((entry) => entry.text.trim() && entry.status === "pending").length;
  $("metric-total").textContent = total;
  $("metric-reviewed").textContent = reviewed + " reviewed";
  $("metric-completed").textContent = completed;
  $("metric-pending").textContent = pending;
  for (const [name, count] of Object.entries({ reviewed, completed, pending })) {
    const bar = $("bar-" + name);
    bar.hidden = count === 0;
    bar.style.width = (total ? (count / total) * 100 : 0) + "%";
  }
}

function refreshActions() {
  const current = draft();
  const total = current.updates.length;
  const missing = current.updates.filter(unresolved).length;
  refreshSummary(current.updates, total - missing);
  const countLabel = total + (total === 1 ? " update" : " updates");
  $("update-count").textContent = missing ? countLabel + " · " + missing + " to review" : countLabel;
  $("generate").disabled = generating || (!current.raw.trim() && (!total || Boolean(missing)));
  $("generate").setAttribute("aria-busy", String(generating));
  $("review").disabled = !current.raw.trim();
  $("stale").hidden = !isStale();
  $("save").disabled = generating || !current.reports || isStale() || !current.reports.overall.subject.trim() || !current.reports.overall.message.trim() ||
    Boolean(current.reports.project && (!current.reports.project.subject.trim() || !current.reports.project.message.trim()));
  const report = current.reports?.[active];
  $("copy").disabled = !report?.subject.trim() || !report?.message.trim();
}

function showReport() {
  const reports = draft().reports;
  const report = reports?.[active];
  $("recipient").textContent = report?.recipient || state.settings[active] || "Team";
  $("report-editor").hidden = !report;
  $("report-empty").hidden = Boolean(report);
  $("report-empty").querySelector("h3").textContent = reports && !report
    ? "No project updates for this date" : "Your draft will appear here";
  $("report-empty").querySelector("p").textContent = reports && !report
    ? "Only updates assigned to one of your projects appear here." : "Add your updates to generate this report.";
  $("subject").value = report?.subject ?? "";
  $("message").value = report?.message ?? "";
  refreshActions();
}

function selectTab(type, focus = false) {
  active = type;
  for (const key of ["overall", "project"]) {
    const tab = $(key + "-tab");
    tab.setAttribute("aria-selected", String(type === key));
    tab.tabIndex = type === key ? 0 : -1;
  }
  $("report-panel").setAttribute("aria-labelledby", type + "-tab");
  showReport();
  if (focus) $(type + "-tab").focus();
}

function showDay(newDate) {
  date = newDate;
  $("report-date").value = date;
  $("raw").value = draft().raw;
  showUpdates();
  selectTab("overall");
  showPage("compose");
}

function showPage(page) {
  for (const key of ["compose", "history"]) {
    $(key).hidden = key !== page;
    const nav = $(key + "-nav");
    nav.classList.toggle("active", key === page);
    if (key === page) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  $("breadcrumb").querySelector("strong").textContent = page === "compose" ? "Compose" : "Report history";
  if (page === "history") showHistory();
}

function showHistory() {
  const dates = Object.keys(state.history).sort().reverse();
  const list = $("history-list");
  list.replaceChildren();
  $("nav-count").textContent = dates.length;
  $("history-empty").hidden = Boolean(dates.length);
  for (const key of dates) {
    const record = state.history[key].draft;
    const row = document.createElement("div");
    row.className = "history-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = displayDate(key);
    const detail = document.createElement("small");
    detail.textContent = record.reports.project ? "Overall EOD and Project EOD" : "Overall EOD";
    const button = document.createElement("button");
    button.className = "btn secondary";
    button.textContent = "Open reports";
    button.setAttribute("aria-label", "Open reports for " + title.textContent);
    button.addEventListener("click", () => showDay(key));
    info.append(title, detail);
    row.append(info, button);
    list.append(row);
  }
}

function showProfile() {
  const name = state.settings.sender;
  $("profile-name").textContent = name || "Your profile";
  $("avatar").textContent = name.trim().charAt(0).toLocaleUpperCase() || "?";
}

function reportHtml(report) {
  const container = document.createElement("div");
  const subject = document.createElement("p");
  subject.textContent = "Subject: " + report.subject;
  container.append(subject);
  let list;
  for (const line of report.message.split("\n")) {
    if (line.startsWith("\u2022 ")) {
      if (!list) {
        list = document.createElement("ul");
        container.append(list);
      }
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.append(item);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const paragraph = document.createElement("p");
    if (/^(Projects?:|Completed Work$|Work Updates$|In Progress \/ Next Steps$)/.test(line)) {
      const strong = document.createElement("strong");
      strong.textContent = line;
      paragraph.append(strong);
    } else {
      paragraph.textContent = line;
    }
    container.append(paragraph);
  }
  return container.innerHTML;
}

function legacyCopy(text) {
  const field = document.createElement("textarea");
  const focused = document.activeElement;
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  focused?.focus();
  return copied;
}

$("raw").addEventListener("input", (event) => {
  draft().raw = event.target.value;
  persist();
  refreshActions();
});

$("review").addEventListener("click", () => {
  const current = draft();
  const updates = parseUpdates(current.raw, state.settings.projects);
  if (!updates.length) {
    notify("Add at least one line describing work.");
    return;
  }
  const start = current.updates.length;
  current.updates.push(...updates);
  current.raw = "";
  $("raw").value = "";
  persist();
  showUpdates();
  refreshActions();
  const first = $("update-list").children[start];
  const pendingField = !updates[0].status ? ".status" : !updates[0].scope ? ".scope" : ".task";
  first.querySelector(pendingField).focus();
});

$("generate").addEventListener("click", async () => {
  if (generating) return;
  const current = draft();
  if (current.edited && !confirm("Replace your edited drafts with newly generated reports?")) return;
  if (current.raw.trim()) {
    const parsed = parseUpdates(current.raw, state.settings.projects);
    if (!parsed.length) {
      notify("Paste at least one work update to generate your EOD.");
      return;
    }
    current.updates.push(...parsed);
    current.raw = "";
    $("raw").value = "";
    showUpdates();
  }
  const reports = {
    overall: reportFor("overall", current.updates, state.settings, displayDate(date)),
    project: reportFor("project", current.updates, state.settings, displayDate(date))
  };
  const sourceSignature = reportSignature();
  const sourceDate = date;
  const previousReports = JSON.stringify(current.reports);
  generating = true;
  refreshActions();
  persist();
  $("ai-status").textContent = "Professionally rewriting your EOD with Cloudflare AI...";
  let rewritten;
  let failure = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("/api/reformat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reports }), signal: controller.signal
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) throw new Error("AI unavailable");
    const result = await response.json();
    const valid = report => report && typeof report.subject === "string" && report.subject.trim() && typeof report.message === "string" && report.message.trim();
    if (!valid(result.reports?.overall) || (reports.project && !valid(result.reports?.project))) throw new Error("Invalid AI output");
    rewritten = result.reports;
  } catch {
    failure = "AI unavailable or not configured. Basic formatting was used; try generating again later.";
  } finally {
    clearTimeout(timeout);
    generating = false;
  }
  if (date !== sourceDate || reportSignature() !== sourceSignature || JSON.stringify(current.reports) !== previousReports) {
    $("ai-status").textContent = "Your notes or report changed while AI was working. Generate again to use the latest version.";
    refreshActions();
    return;
  }
  current.reports = rewritten || reports;
  current.edited = false;
  current.signature = sourceSignature;
  current.formatter = rewritten ? "ai" : "basic";
  persist();
  showReport();
  $("ai-status").textContent = failure || "Rewritten with Cloudflare AI. Review the wording before copying.";
  notify(failure || "Your professional EOD is ready.");
});

for (const field of ["subject", "message"]) {
  $(field).addEventListener("input", (event) => {
    const current = draft();
    current.reports[active][field] = event.target.value;
    current.edited = true;
    persist();
    refreshActions();
  });
}

$("copy").addEventListener("click", async () => {
  const report = draft().reports[active];
  const plain = "Subject: " + report.subject + "\n\n" + report.message;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([plain], { type: "text/plain" }),
        "text/html": new Blob([reportHtml(report)], { type: "text/html" })
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
  } catch {
    try {
      if (!legacyCopy(plain)) throw new Error("Clipboard unavailable");
    } catch {
      $("message").focus();
      $("message").select();
      notify("Clipboard unavailable. The message is selected for manual copying.");
      return;
    }
  }
  notify("Report copied.");
});

$("save").addEventListener("click", async () => {
  state.history[date] = { draft: structuredClone(draft()) };
  if (await persist()) notify("Saved to report history.");
  showHistory();
});

$("report-date").addEventListener("change", (event) => {
  if (event.target.validity.valid && event.target.value) showDay(event.target.value);
  else event.target.value = date;
});
$("compose-nav").addEventListener("click", () => showPage("compose"));
$("history-nav").addEventListener("click", () => showPage("history"));
$("today").addEventListener("click", () => showDay(reportDate()));

for (const key of ["overall", "project"]) {
  const tab = $(key + "-tab");
  tab.addEventListener("click", () => selectTab(key));
  tab.addEventListener("keydown", (event) => {
    const other = key === "overall" ? "project" : "overall";
    const target = { ArrowLeft: other, ArrowRight: other, Home: "overall", End: "project" }[event.key];
    if (target) {
      event.preventDefault();
      selectTab(target, true);
    }
  });
}

$("tips-toggle").addEventListener("click", () => {
  const tips = $("tips");
  tips.hidden = !tips.hidden;
  $("tips-toggle").setAttribute("aria-expanded", String(!tips.hidden));
});

function openSettings() {
  const form = $("settings-form");
  for (const key of Object.keys(defaults)) {
    const field = form.elements.namedItem(key);
    field.value = key === "projects" ? state.settings.projects.join(", ") : state.settings[key];
    field.setCustomValidity("");
  }
  $("settings-dialog").showModal();
}
$("settings-open").addEventListener("click", openSettings);
for (const id of ["settings-close", "settings-cancel"]) {
  $(id).addEventListener("click", () => $("settings-dialog").close());
}
$("settings-form").addEventListener("input", (event) => event.target.setCustomValidity(""));
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  for (const [key, value] of Object.entries(values)) {
    if (!value.trim() && key === "zone") {
      const field = form.elements.namedItem(key);
      field.setCustomValidity("Enter a value.");
      field.reportValidity();
      return;
    }
    values[key] = value.trim();
  }
  const projects = values.projects.split(",").map((name) => name.trim()).filter(Boolean);
  const uniqueProjects = [...new Map(projects.filter(normalizeProject).map((name) => [normalizeProject(name), name])).values()];
  state.settings = { ...values, projects: uniqueProjects };
  const stored = await persist();
  $("settings-dialog").close();
  showProfile();
  showUpdates();
  showReport();
  if (stored) notify("Settings saved.");
});

function pruneStoredDays() {
  const today = reportDate();
  const earliest = new Date(today + "T00:00:00Z");
  earliest.setUTCDate(earliest.getUTCDate() - 2);
  const minimum = earliest.toISOString().slice(0, 10);
  for (const collection of [state.drafts, state.history]) {
    for (const key of Object.keys(collection)) {
      if (key < minimum || key > today) delete collection[key];
    }
  }
  $("report-date").min = minimum;
  $("report-date").max = today;
  return { minimum, today };
}

async function initialize() {
  try {
    let stored;
    const response = await fetch("/api/state");
    if (response.ok && response.headers.get("Content-Type")?.includes("application/json")) {
      stored = await response.json();
      storageMode = "sqlite";
    } else if (response.status === 404 || (response.ok && response.headers.get("Content-Type")?.includes("text/html"))) {
      try { stored = JSON.parse(localStorage.getItem(storageKey)); }
      catch { storageIssue = true; }
    } else {
      throw new Error("Storage service failed");
    }
    state = {
      settings: { ...defaults, ...stored?.settings },
      drafts: stored?.drafts ?? {}, history: stored?.history ?? {}
    };
    if (storageMode === "sqlite" && !stored?.settings) {
      try {
        const legacy = JSON.parse(localStorage.getItem(storageKey));
        if (legacy) {
          state = { settings: { ...defaults, ...legacy.settings }, drafts: legacy.drafts ?? {}, history: legacy.history ?? {} };
          if (await persist()) localStorage.removeItem(storageKey);
        }
      } catch { storageIssue = true; }
    }
    date = reportDate();
    pruneStoredDays();
    await persist();
    $("storage-label").textContent = storageMode === "sqlite" ? "SQLite - 3 days" : "This browser - 3 days";
    showProfile();
    showDay(date);
    showHistory();
    if (storageIssue) notify("Previous browser data could not be read.");
    setInterval(() => {
      const { minimum, today } = pruneStoredDays();
      if (date < minimum || date > today) showDay(today);
      persist();
      showHistory();
    }, 60000);
  } catch {
    document.querySelector("main").textContent = "Storage could not be loaded. Please reload this page, or restart python server.py if using local SQLite.";
  }
}
initialize();
