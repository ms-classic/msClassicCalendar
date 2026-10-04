"use strict";

const core = globalThis.MapleCalendar;
const events = core.validateEvents(globalThis.MAPLE_EVENTS);
const $ = (id) => document.getElementById(id);
const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const storageKey = "maple-calendar-timezone";
let timezone = detectedTimezone;
let filter = "all";
let activeEvent = null;
let nextEvent = null;
let previousDayKey = "";
let previousUpcomingKey = "";
let year;
let month;

function storageNotice(action, error) {
  console.warn(`Timezone preference could not be ${action}.`, error);
  $("storage-notice").textContent = "Your browser blocked saved preferences. Timezone changes still work for this visit.";
  $("storage-notice").hidden = false;
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved && core.isValidTimezone(saved)) timezone = saved;
  else if (saved) {
    console.warn("Ignoring an unsupported saved timezone:", saved);
    $("storage-notice").textContent = "Your saved timezone is no longer supported. Using your device timezone.";
    $("storage-notice").hidden = false;
  }
} catch (error) {
  storageNotice("loaded", error);
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(new Date(value));
}

function eventTime(event) {
  if (event.startDate) return "Opening time not announced";
  return formatDate(event.start, { hour: "numeric", minute: "2-digit" });
}

function formatStart(event, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: event.startDate ? "UTC" : timezone, ...options })
    .format(new Date(event.start || `${event.startDate}T00:00:00Z`));
}

function startDescription(event) {
  return event.start ? fullDate(event.start)
    : `${formatStart(event, { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · Opening time not announced`;
}

function eventWindow(event) {
  if (!event.end) return eventTime(event);
  const startDay = event.startDate || core.dateKey(core.zonedParts(new Date(event.start), timezone));
  const sameDay = startDay === core.dateKey(core.zonedParts(new Date(event.end), timezone));
  const end = formatDate(event.end, { ...(sameDay ? {} : { month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit" });
  return `${eventTime(event)} – ${end}`;
}

function upcomingKey(upcoming, now) {
  return upcoming.map((event) => `${event.id}:${core.hasReachedStart(event, now, timezone)}`).join(",");
}

function fullDate(value) {
  return formatDate(value, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function timezoneLabel(zone) {
  return zone.replaceAll("_", " ").replaceAll("/", " / ");
}

function buildTimezoneOptions() {
  const common = ["UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Singapore", "Asia/Seoul", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : common;
  const zones = [...new Set([detectedTimezone, timezone, ...common, ...supported])].filter(core.isValidTimezone).sort();
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = timezoneLabel(zone);
    $("timezone").append(option);
  }
  $("timezone").value = timezone;
}

function refreshTimezoneLabel() {
  $("timezone-status").textContent = timezone === detectedTimezone ? "Auto-detected" : "Custom";
  $("calendar-zone").textContent = timezoneLabel(timezone);
}

function eventButton(event, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${className} ${event.category}${event.kind === "sale" ? " sale" : ""}`;
  button.setAttribute("aria-label", `${event.title}, ${startDescription(event)}${event.end ? `, ends ${fullDate(event.end)}` : ""}`);
  button.addEventListener("click", () => showEvent(event));
  return button;
}

function renderCalendar() {
  const selected = events.filter((event) => filter === "all" || event.category === filter);
  const today = core.dateKey(core.zonedParts(new Date(), timezone));
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  $("month-title").textContent = monthName;
  $("calendar-grid").setAttribute("aria-label", `${monthName} event calendar`);
  const fragment = document.createDocumentFragment();
  const monthEvents = new Set();
  const cells = core.monthCells(year, month);
  for (let offset = 0; offset < cells.length; offset += 7) {
    const weekCells = cells.slice(offset, offset + 7);
    const { segments, laneCount } = core.weekSegments(selected, weekCells, timezone);
    const spanningIds = new Set(segments.map(({ event }) => event.id));
    const week = document.createElement("div");
    week.className = "calendar-week";
    week.style.gridTemplateRows = `var(--date-row-height) ${laneCount ? `repeat(${laneCount}, var(--range-row-height)) ` : ""}minmax(var(--single-row-height), auto)`;
    for (const [column, cell] of weekCells.entries()) {
      const day = document.createElement("div");
      day.className = `calendar-day${cell.inMonth ? "" : " outside"}${cell.key === today ? " today" : ""}`;
      day.style.gridColumn = column + 1;
      const date = document.createElement("time");
      date.dateTime = cell.key;
      date.className = "day-number";
      date.textContent = cell.day;
      if (cell.key === today) date.setAttribute("aria-label", `${cell.key}, today`);
      day.append(date);
      week.append(day);
    }
    for (const segment of segments) {
      const { event, startColumn, endColumn, lane, continuesBefore, continuesAfter } = segment;
      const button = eventButton(event, "calendar-event calendar-range");
      button.classList.toggle("continues-before", continuesBefore);
      button.classList.toggle("continues-after", continuesAfter);
      button.classList.toggle("compact-range", endColumn - startColumn < 3);
      button.style.gridColumn = `${startColumn + 1} / ${endColumn + 2}`;
      button.style.gridRow = lane + 2;
      button.title = button.getAttribute("aria-label");
      const leading = document.createElement("span");
      leading.className = "range-arrow";
      leading.textContent = continuesBefore ? "←" : "";
      leading.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.textContent = event.shortTitle || event.title;
      title.className = "range-title";
      const time = document.createElement("small");
      time.textContent = !continuesBefore ? event.startDate ? "Opening time not announced" : `Starts ${eventTime(event)}` : !continuesAfter ? `Ends ${formatDate(event.end, { hour: "numeric", minute: "2-digit" })}` : "Continues";
      const trailing = document.createElement("span");
      trailing.className = "range-arrow";
      trailing.textContent = continuesAfter ? "→" : "";
      trailing.setAttribute("aria-hidden", "true");
      button.append(leading, title, time, trailing);
      week.append(button);
    }
    for (const [column, cell] of weekCells.entries()) {
      const dayEvents = document.createElement("div");
      dayEvents.className = "day-events";
      dayEvents.style.gridColumn = column + 1;
      dayEvents.style.gridRow = laneCount + 2;
      for (const event of core.eventsOnDay(selected, cell.key, timezone)) {
        if (cell.inMonth) monthEvents.add(event.id);
        if (spanningIds.has(event.id)) continue;
        const button = eventButton(event, "calendar-event");
        const title = document.createElement("span");
        title.textContent = event.shortTitle || event.title;
        const time = document.createElement("small");
        time.textContent = eventWindow(event);
        button.append(title, time);
        dayEvents.append(button);
      }
      week.append(dayEvents);
    }
    fragment.append(week);
  }
  $("calendar-grid").replaceChildren(fragment);
  $("month-count").textContent = `${monthEvents.size} ${monthEvents.size === 1 ? "event" : "events"}`;
  $("empty-month").hidden = monthEvents.size !== 0;
}

function renderUpcoming(now) {
  const upcoming = core.upcomingEvents(events, now, timezone);
  previousUpcomingKey = upcomingKey(upcoming, now);
  $("upcoming-count").textContent = upcoming.length;
  const fragment = document.createDocumentFragment();
  for (const event of upcoming) {
    const button = eventButton(event, "upcoming-event");
    const date = document.createElement("span");
    date.className = "date-tile";
    const monthLabel = document.createElement("small");
    monthLabel.textContent = formatStart(event, { month: "short" });
    const dayLabel = document.createElement("strong");
    dayLabel.textContent = formatStart(event, { day: "numeric" });
    date.append(monthLabel, dayLabel);
    const info = document.createElement("span");
    info.className = "upcoming-info";
    const title = document.createElement("strong");
    title.textContent = event.shortTitle || event.title;
    const time = document.createElement("small");
    const happeningNow = event.end && core.hasReachedStart(event, now, timezone);
    const category = event.category === "launch" ? "Launch" : event.kind === "deadline" ? "Deadline" : event.kind === "sale" ? "Sale" : event.kind === "claim-window" ? "Pickup window" : "Event";
    time.textContent = happeningNow
      ? `${event.startDate ? "Pickup period" : "Live now"} · Ends ${formatDate(event.end, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : `${eventWindow(event)} · ${category}`;
    info.append(title, time);
    const arrow = document.createElement("span");
    arrow.className = "event-arrow";
    arrow.textContent = "↗";
    arrow.setAttribute("aria-hidden", "true");
    button.append(date, info, arrow);
    fragment.append(button);
  }
  if (!upcoming.length) {
    const message = document.createElement("p");
    message.className = "no-upcoming";
    message.textContent = "You’re all caught up. Check official news for the next adventure.";
    fragment.append(message);
  }
  $("upcoming-list").replaceChildren(fragment);
  nextEvent = upcoming.find((event) => !core.hasReachedStart(event, now, timezone)) || upcoming[0] || null;
  $("next-event-title").textContent = nextEvent ? nextEvent.shortTitle || nextEvent.title : "More adventures ahead";
  $("next-event-date").textContent = nextEvent ? nextEvent.startDate
    ? `${formatStart(nextEvent, { month: "short", day: "numeric", year: "numeric" })} · Opening time not announced`
    : formatDate(nextEvent.start, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "No future announced dates";
  $("next-event-details").hidden = !nextEvent;
  renderCountdown(now);
}

function renderCountdown(now) {
  $("countdown").classList.toggle("countdown-message", Boolean(nextEvent &&
    (nextEvent.startDate || (nextEvent.end && core.hasReachedStart(nextEvent, now, timezone)))));
  if (!nextEvent) {
    $("countdown").replaceChildren();
    $("countdown").removeAttribute("aria-label");
    return;
  }
  if (nextEvent.startDate) {
    $("countdown").textContent = "Opening time not announced";
    $("countdown").setAttribute("aria-label", "No precise countdown is available because the opening time is not announced.");
    return;
  }
  if (core.hasReachedStart(nextEvent, now, timezone) && nextEvent.end) {
    $("countdown").textContent = "Happening now";
    $("countdown").setAttribute("aria-label", `${nextEvent.title} is happening now`);
    return;
  }
  const remaining = core.countdown(nextEvent.start, now);
  const fragment = document.createDocumentFragment();
  for (const [label, value] of Object.entries(remaining)) {
    const block = document.createElement("div");
    const number = document.createElement("strong");
    number.textContent = String(value).padStart(2, "0");
    const caption = document.createElement("span");
    caption.textContent = label;
    block.append(number, caption);
    fragment.append(block);
  }
  $("countdown").replaceChildren(fragment);
  $("countdown").setAttribute("aria-label", `${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, ${remaining.seconds} seconds until ${nextEvent.title}`);
}

function showEvent(event) {
  activeEvent = event;
  $("dialog-category").textContent = event.category === "launch" ? "Launch day" : event.kind === "deadline" ? "Deadline" : event.kind === "sale" ? "Sale" : event.kind === "claim-window" ? "Pickup window" : "Event";
  $("dialog-category").className = `event-category ${event.category}${event.kind === "sale" ? " sale" : ""}`;
  $("dialog-title").textContent = event.title;
  $("dialog-description").textContent = event.description;
  $("dialog-time-label").textContent = event.kind === "deadline" ? "Deadline" : event.startDate ? "Opening date (time not announced)" : "Starts";
  $("dialog-start").textContent = startDescription(event);
  $("dialog-end-row").hidden = !event.end;
  $("dialog-end").textContent = event.end ? fullDate(event.end) : "";
  $("dialog-zone").textContent = `${timezoneLabel(timezone)}${event.startDate ? " (cutoff time; opening date is shown as announced)" : ""}`;
  $("dialog-original").textContent = event.originalTime || "See official announcement.";
  $("dialog-note").textContent = event.note || "Schedules may change. Please check the official source.";
  $("dialog-source").href = event.source;
  $("dialog-timing-source").hidden = !event.timingSource;
  if (event.timingSource) $("dialog-timing-source").href = event.timingSource;
  else $("dialog-timing-source").removeAttribute("href");
  $("dialog-details-source").hidden = !event.detailsSource;
  if (event.detailsSource) $("dialog-details-source").href = event.detailsSource;
  else $("dialog-details-source").removeAttribute("href");
  if (!$("event-dialog").open) $("event-dialog").showModal();
}

function tick() {
  const now = new Date();
  const dayKey = core.dateKey(core.zonedParts(now, timezone));
  $("live-clock").textContent = formatDate(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  $("live-clock").dateTime = now.toISOString();
  $("live-date").textContent = formatDate(now, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (dayKey !== previousDayKey) {
    previousDayKey = dayKey;
    renderCalendar();
  }
  const currentUpcomingKey = upcomingKey(core.upcomingEvents(events, now, timezone), now);
  if (currentUpcomingKey !== previousUpcomingKey) renderUpcoming(now);
  else renderCountdown(now);
}

function setTimezone(zone) {
  if (!core.isValidTimezone(zone)) throw new Error(`Unsupported timezone: ${zone}`);
  timezone = zone;
  $("timezone").value = zone;
  try {
    localStorage.setItem(storageKey, zone);
  } catch (error) {
    storageNotice("saved", error);
  }
  refreshTimezoneLabel();
  renderCalendar();
  renderUpcoming(new Date());
  if (activeEvent && $("event-dialog").open) showEvent(activeEvent);
  tick();
}

function moveMonth(offset) {
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  year = target.getUTCFullYear();
  month = target.getUTCMonth() + 1;
  renderCalendar();
}

buildTimezoneOptions();
refreshTimezoneLabel();
const initialParts = core.zonedParts(new Date(), timezone);
year = initialParts.year;
month = initialParts.month;
$("timezone").addEventListener("change", (event) => setTimezone(event.target.value));
$("detect-timezone").addEventListener("click", () => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone));
$("previous-month").addEventListener("click", () => moveMonth(-1));
$("next-month").addEventListener("click", () => moveMonth(1));
$("today-button").addEventListener("click", () => {
  const today = core.zonedParts(new Date(), timezone);
  year = today.year;
  month = today.month;
  renderCalendar();
});
for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    for (const other of document.querySelectorAll("[data-filter]")) {
      const selected = other === button;
      other.classList.toggle("active", selected);
      other.setAttribute("aria-pressed", String(selected));
    }
    renderCalendar();
  });
}
$("next-event-details").addEventListener("click", () => { if (nextEvent) showEvent(nextEvent); });
$("close-dialog").addEventListener("click", () => $("event-dialog").close());
$("event-dialog").addEventListener("close", () => { activeEvent = null; });
$("event-dialog").addEventListener("click", (event) => {
  if (event.target !== $("event-dialog")) return;
  const rect = $("event-dialog").getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $("event-dialog").close();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
renderUpcoming(new Date());
tick();
setInterval(tick, 1000);
