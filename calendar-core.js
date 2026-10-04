(function (root) {
  "use strict";

  function isValidTimezone(zone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format();
      return typeof zone === "string" && zone.length > 0;
    } catch (error) {
      if (error instanceof RangeError) return false;
      throw error;
    }
  }

  function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return { year: get("year"), month: get("month"), day: get("day") };
  }

  function dateKey(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function monthCells(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const count = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, 1 - offset + index));
      const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      return { ...parts, key: dateKey(parts), inMonth: parts.month === month };
    });
  }

  function eventDateRange(event, timeZone) {
    const startKey = event.startDate || dateKey(zonedParts(new Date(event.start), timeZone));
    // Ranges are [start, end); subtract 1 ms so a midnight end doesn't occupy the next day.
    const endKey = event.end ? dateKey(zonedParts(new Date(Date.parse(event.end) - 1), timeZone)) : startKey;
    return { startKey, endKey };
  }

  function eventsOnDay(events, key, timeZone) {
    return events.filter((event) => {
      const { startKey, endKey } = eventDateRange(event, timeZone);
      return startKey <= key && key <= endKey;
    }).sort((a, b) => compareEvents(a, b, timeZone));
  }

  function compareEvents(a, b, timeZone) {
    const dateOrder = eventDateRange(a, timeZone).startKey.localeCompare(eventDateRange(b, timeZone).startKey);
    if (dateOrder) return dateOrder;
    if (a.start && b.start) return Date.parse(a.start) - Date.parse(b.start);
    return Number(Boolean(a.start)) - Number(Boolean(b.start));
  }

  function hasReachedStart(event, now, timeZone) {
    return event.startDate
      ? dateKey(zonedParts(now, timeZone)) >= event.startDate
      : Date.parse(event.start) <= now.getTime();
  }

  function weekSegments(events, cells, timeZone) {
    const ranges = events.map((event) => ({ event, ...eventDateRange(event, timeZone) }))
      .filter(({ startKey, endKey }) => startKey < endKey && startKey <= cells[6].key && endKey >= cells[0].key)
      .sort((a, b) => a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey) || a.event.id.localeCompare(b.event.id));
    const laneEnds = [];
    const segments = ranges.map(({ event, startKey, endKey }) => {
      const startColumn = cells.findIndex((cell) => cell.key >= startKey);
      const endColumn = cells.findLastIndex((cell) => cell.key <= endKey);
      let lane = laneEnds.findIndex((end) => end < startColumn);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = endColumn;
      return {
        event, startColumn, endColumn, lane,
        continuesBefore: startKey < cells[0].key,
        continuesAfter: endKey > cells[6].key,
      };
    });
    return { segments, laneCount: laneEnds.length };
  }

  function upcomingEvents(events, now, timeZone = "UTC") {
    const today = dateKey(zonedParts(now, timeZone));
    return events.filter((event) => {
      if (event.end || event.start) return Date.parse(event.end || event.start) > now.getTime();
      return event.startDate >= today;
    }).sort((a, b) => compareEvents(a, b, timeZone));
  }

  function countdown(target, now) {
    let seconds = Math.max(0, Math.ceil((Date.parse(target) - now.getTime()) / 1000));
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    return { days, hours, minutes: Math.floor(seconds / 60), seconds: seconds % 60 };
  }

  function validateEvents(events) {
    const ids = new Set();
    for (const event of events) {
      if (!event.id || ids.has(event.id)) throw new Error("Event IDs must be present and unique.");
      ids.add(event.id);
      if (!event.title || !event.description || !["launch", "event"].includes(event.category)) {
        throw new Error(`Invalid event metadata: ${event.id}`);
      }
      if (Boolean(event.start) === Boolean(event.startDate)) throw new Error(`Exactly one start instant or start date is required: ${event.id}`);
      if (event.startDate) {
        const date = new Date(`${event.startDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(event.startDate) || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== event.startDate) throw new Error(`Invalid start date: ${event.id}`);
      }
      for (const key of ["start", "end"]) {
        if (key === "start" && event.startDate) continue;
        if (key === "end" && !event.end) continue;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(event[key]) ||
          !Number.isFinite(Date.parse(event[key]))) throw new Error(`Invalid UTC ${key}: ${event.id}`);
      }
      if (event.end && Date.parse(event.end) <= Date.parse(event.start)) throw new Error(`Invalid range: ${event.id}`);
      if (event.startDate && event.end && event.end.slice(0, 10) < event.startDate) throw new Error(`Invalid range: ${event.id}`);
      const url = new URL(event.source);
      if (url.protocol !== "https:") throw new Error(`Event source must use HTTPS: ${event.id}`);
      if (event.timingSource && new URL(event.timingSource).protocol !== "https:") {
        throw new Error(`Event timing source must use HTTPS: ${event.id}`);
      }
      if (event.detailsSource && new URL(event.detailsSource).protocol !== "https:") {
        throw new Error(`Event details source must use HTTPS: ${event.id}`);
      }
    }
    return events;
  }

  const api = { isValidTimezone, zonedParts, dateKey, monthCells, eventDateRange, eventsOnDay, weekSegments, hasReachedStart, upcomingEvents, countdown, validateEvents };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MapleCalendar = api;
})(globalThis);
