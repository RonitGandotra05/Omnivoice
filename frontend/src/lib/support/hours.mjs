import { Temporal } from "@js-temporal/polyfill";
function boundary(date, clock, zone, closing = false) {
  const plain = date.toPlainDateTime(Temporal.PlainTime.from(clock));
  const earlier = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
  const later = plain.toZonedDateTime(zone, { disambiguation: "later" });
  if (
    earlier.toPlainDateTime().equals(plain) &&
    later.toPlainDateTime().equals(plain)
  )
    return closing ? earlier : later;
  // DST gap: advance to the first real local minute, as in the Python implementation.
  for (let n = 1; n <= 180; n++) {
    const next = plain.add({ minutes: n });
    const z = next.toZonedDateTime(zone, { disambiguation: "later" });
    if (z.toPlainDateTime().equals(next)) return z;
  }
  throw new Error("Cannot resolve business hours");
}
export function availability(profile, at = new Date().toISOString()) {
  const instant = Temporal.Instant.from(at);
  const zone = profile.timezone || "UTC";
  const local = instant.toZonedDateTimeISO(zone);
  const result = {
    timezone: zone,
    local_time: local.toString({ timeZoneName: "never" }),
    status: "unknown",
    next_open: null,
    closes_at: null,
    transfer_configured: !!profile.human_phone,
    available: false,
  };
  if (!profile.hours_enabled || !profile.office_hours?.length)
    return {
      ...result,
      message:
        "Human support hours are not configured. Save a follow-up request without promising availability.",
    };
  const intervals = [];
  for (let offset = -1; offset < 69; offset++) {
    const day = local.toPlainDate().add({ days: offset });
    if (profile.holidays?.includes(day.toString())) continue;
    for (const w of profile.office_hours || []) {
      if (w.day !== day.dayOfWeek - 1) continue;
      const endDay = day.add({ days: w.closes < w.opens ? 1 : 0 });
      const start = boundary(day, w.opens, zone);
      const end = boundary(
        endDay,
        profile.holidays?.includes(endDay.toString()) ? "00:00" : w.closes,
        zone,
        true,
      );
      if (end.epochMilliseconds > start.epochMilliseconds)
        intervals.push([start, end]);
    }
  }
  intervals.sort((a, b) => a[0].epochMilliseconds - b[0].epochMilliseconds);
  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start.epochMilliseconds <= last[1].epochMilliseconds) {
      if (end.epochMilliseconds > last[1].epochMilliseconds) last[1] = end;
    } else merged.push([start, end]);
  }
  const active = merged.find(
    ([s, e]) =>
      s.epochMilliseconds <= instant.epochMilliseconds &&
      instant.epochMilliseconds < e.epochMilliseconds,
  );
  if (active)
    return {
      ...result,
      status: "open",
      available: !!profile.human_phone,
      closes_at: active[1].toString({ timeZoneName: "never" }),
      message:
        "Within configured hours. Staff presence and transfer success are not guaranteed.",
    };
  const next = merged.find(
    ([s]) => s.epochMilliseconds > instant.epochMilliseconds,
  );
  return {
    ...result,
    status: "closed",
    next_open: next?.[0].toString({ timeZoneName: "never" }) || null,
    message:
      "Human support is closed. A callback request is not a booked appointment.",
  };
}
