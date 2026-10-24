"use client";
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export default function BusinessHours({ profile, update }) {
  const windows = profile.office_hours || [];
  const edit = (i, field, value) =>
    update(
      "office_hours",
      windows.map((w, n) => (n === i ? { ...w, [field]: value } : w)),
    );
  return (
    <details className="support-hours">
      <summary>Human availability & callback hours</summary>
      <p>
        AI support can answer at any time. These hours describe your human team.
        Overnight shifts are supported.
      </p>
      <div className="two-columns">
        <label className="field">
          Company timezone
          <input
            value={profile.timezone || "UTC"}
            onChange={(e) => update("timezone", e.target.value)}
            placeholder="Asia/Kolkata"
          />
        </label>
        <label className="field">
          Human transfer number
          <input
            type="tel"
            value={profile.human_phone || ""}
            onChange={(e) => update("human_phone", e.target.value)}
            placeholder="+14155550100"
          />
          <small>
            Optional. Connected telephone calls only; your phone system must
            enforce team availability.
          </small>
        </label>
      </div>
      <label className="caller-consent">
        <input
          type="checkbox"
          checked={!!profile.hours_enabled}
          onChange={(e) => update("hours_enabled", e.target.checked)}
        />{" "}
        Use these human support hours
      </label>
      {profile.hours_enabled && (
        <>
          {windows.map((w, i) => (
            <div className="hours-row" key={i}>
              <label className="hours-day">
                Day
                <select
                  aria-label={`Shift ${i + 1} day`}
                  value={w.day}
                  onChange={(e) => edit(i, "day", Number(e.target.value))}
                >
                  {days.map((day, n) => (
                    <option key={day} value={n}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hours-time">
                Opens
                <input
                  type="time"
                  aria-label={`Shift ${i + 1} opens`}
                  value={w.opens}
                  onChange={(e) => edit(i, "opens", e.target.value)}
                />
              </label>
              <label className="hours-time">
                Closes
                <input
                  type="time"
                  aria-label={`Shift ${i + 1} closes`}
                  value={w.closes}
                  onChange={(e) => edit(i, "closes", e.target.value)}
                />
              </label>
              <button
                type="button"
                className="text-link"
                aria-label={`Remove shift ${i + 1}`}
                onClick={() =>
                  update(
                    "office_hours",
                    windows.filter((_, n) => n !== i),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-link"
            disabled={windows.length >= 21}
            onClick={() =>
              update("office_hours", [
                ...windows,
                { day: 0, opens: "09:00", closes: "18:00" },
              ])
            }
          >
            + Add a shift
          </button>
          <label className="field">
            Holiday closures
            <input
              value={(profile.holidays || []).join(", ")}
              onChange={(e) =>
                update(
                  "holidays",
                  e.target.value
                    .split(",")
                    .map((d) => d.trim())
                    .filter(Boolean),
                )
              }
              placeholder="2026-12-25, 2027-01-01"
            />
            <small>
              Comma-separated dates, YYYY-MM-DD. A holiday also closes overnight
              shifts at midnight.
            </small>
          </label>
        </>
      )}
      <label className="field">
        Callback response target (hours, optional)
        <input
          type="number"
          min="1"
          max="720"
          step="1"
          value={profile.callback_response_hours ?? ""}
          onChange={(event) =>
            update(
              "callback_response_hours",
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
          placeholder="For example, 72"
        />
        <small>
          Only set a timeframe your team actually supports. Without one, the
          agent records a request without promising a response deadline.
        </small>
      </label>
      {!profile.hours_enabled && (
        <small>
          Hours unknown: the agent saves a follow-up request without claiming
          staff are available.
        </small>
      )}
    </details>
  );
}
