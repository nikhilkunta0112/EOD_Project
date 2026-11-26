"use strict";

const storageKey = "eod-reporting-desk-public-v1";
const $ = (id) => document.getElementById(id);
let storageIssue = false;
let state = restore();
let date = reportDate();
let active = "overall";
let noticeTimer;

function restore() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    return {
      settings: { ...defaults, ...stored?.settings },
      drafts: stored?.drafts ?? {},
      history: stored?.history ?? {}
    };
  } catch {
    storageIssue = true;
    return { settings: { ...defaults }, drafts: {}, history: {} };
  }
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    return true;
  } catch {
    notify("This browser could not store your changes. Copy your report before leaving.");
    return false;
  }
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

function parseUpdates(text, projects) {
  const heading = /^(completed(?: work| tasks| updates)?|pending(?: tasks| work)?|upcoming tasks|next steps|in progress)$/i;
  const updates = [];
  let groupStatus = "";
  for (const rawLine of text.split(/\r?\n/)) {
    let task = rawLine.trim().replace(/^(?:[-*•–]\s+|\d+[.)]\s+)/u, "");
    if (!task) continue;
    const label = task.replace(/:\s*$/, "").trim();
    if (heading.test(label)) {
      groupStatus = /^completed/i.test(label) ? "completed" : "pending";
      continue;
    }
    let status = groupStatus;
    const statusPrefix = task.match(/^(completed|pending|in progress|upcoming)\s*:\s*(.+)$/i);
    if (statusPrefix) {
      status = /^completed$/i.test(statusPrefix[1]) ? "completed" : "pending";
      task = statusPrefix[2];
    } else if (/^(need to|still need to|to do|plan to|will |ongoing\b|in progress\b)/i.test(task)) {
      status = "pending";
    }
    const prefix = task.match(/^([^:]+):\s*(.+)$/);
    const explicit = prefix && projects.find((name) => normalizeProject(name) === normalizeProject(prefix[1]));
    const general = prefix && /^(general|other)$/i.test(prefix[1].trim());
    const project = explicit || (!general && projects.find((name) => projectMention(task, name)));
    if (explicit || general) task = prefix[2];
    updates.push({ text: task.trim(), status, scope: general ? "general" : project ? "project:" + project : "" });
  }
  return updates;
}

function reportFor(type, updates, settings, reportDay) {
  const scoped = type === "project";
  const recipient = settings[type];
  const visible = scoped
    ? updates.filter((entry) => usedInProjectReport(entry, settings.projects))
    : updates;
  if (!visible.length) return null;
  const usedProjects = settings.projects.filter((name) => visible.some((entry) => entry.scope === "project:" + name));
  const projectNames = usedProjects.join(" / ");
  const subject = scoped
    ? "EOD Status Update – " + projectNames + " – " + reportDay
    : "EOD Status Update – " + reportDay;
  const lines = [
    "Hi " + recipient + ",", "",
    scoped
      ? "Please find my end-of-day status update for " + projectNames + ":"
      : "Please find my end-of-day status update below.",
    "", "Date: " + reportDay
  ];
  const includesGeneralWork = visible.some((entry) => entry.scope === "general");
  if (!includesGeneralWork) lines.push("Project: " + projectNames);
  const completed = visible.filter((entry) => entry.status === "completed");
  const pending = visible.filter((entry) => entry.status === "pending");
  if (completed.length) lines.push("", "Completed Work", "", ...completed.map((entry) => "• " + entry.text.trim()));
  if (pending.length) lines.push("", "Upcoming Tasks", "", ...pending.map((entry) => "• " + entry.text.trim()));
  lines.push("", "Thanks & Regards,", settings.sender);
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
  $("generate").disabled = !state.settings.sender || !total || Boolean(missing || current.raw.trim());
  $("review").disabled = !current.raw.trim();
  $("stale").hidden = !isStale();
  $("save").disabled = !current.reports || isStale() || !current.reports.overall.subject.trim() || !current.reports.overall.message.trim() ||
    Boolean(current.reports.project && (!current.reports.project.subject.trim() || !current.reports.project.message.trim()));
  const report = current.reports?.[active];
  $("copy").disabled = !report?.subject.trim() || !report?.message.trim();
}

function showReport() {
  const reports = draft().reports;
  const report = reports?.[active];
  $("recipient").textContent = report?.recipient || state.settings[active] || "Set in Settings";
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
    if (line.startsWith("• ")) {
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
    if (/^(Project:|Completed Work$|Upcoming Tasks$)/.test(line)) {
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

$("generate").addEventListener("click", () => {
  const current = draft();
  if (current.edited && !confirm("Replace your edited drafts with newly generated reports?")) return;
  current.reports = {
    overall: reportFor("overall", current.updates, state.settings, displayDate(date)),
    project: reportFor("project", current.updates, state.settings, displayDate(date))
  };
  current.edited = false;
  current.signature = reportSignature();
  persist();
  showReport();
  notify(current.reports.project ? "Both reports are ready." : "Overall report is ready. No project updates were assigned.");
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

$("save").addEventListener("click", () => {
  state.history[date] = { draft: structuredClone(draft()) };
  if (persist()) notify("Saved to report history.");
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
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  for (const [key, value] of Object.entries(values)) {
    if (!value.trim()) {
      const field = form.elements.namedItem(key);
      field.setCustomValidity("Enter a value.");
      field.reportValidity();
      return;
    }
    values[key] = value.trim();
  }
  const projects = values.projects.split(",").map((name) => name.trim()).filter(Boolean);
  const uniqueProjects = [...new Map(projects.filter(normalizeProject).map((name) => [normalizeProject(name), name])).values()];
  if (!uniqueProjects.length) {
    form.elements.projects.setCustomValidity("Enter at least one project name.");
    form.elements.projects.reportValidity();
    return;
  }
  state.settings = { ...values, projects: uniqueProjects };
  const stored = persist();
  $("settings-dialog").close();
  showProfile();
  showUpdates();
  showReport();
  if (stored) notify("Settings saved.");
});

showProfile();
showDay(date);
showHistory();
if (!state.settings.sender) openSettings();
if (storageIssue) notify("Stored reports could not be read in this browser.");
