"use client";
export default function CallerDetails({ caller, availability }) {
  return (
    <section
      className="caller-details"
      aria-label="Collected caller details"
      aria-live="polite"
    >
      <div className="document-heading">
        <h3>Caller details</h3>
        <span className="tag">
          {caller?.saved
            ? caller.storage === "browser"
              ? "Saved in this browser"
              : "Saved to workspace"
            : caller
              ? "Preview · not saved"
              : "Awaiting caller"}
        </span>
      </div>
      <dl className="caller-facts">
        {[
          ["Name", caller?.name],
          ["Callback number", caller?.phone],
          ["Email", caller?.email],
          ["Reason", caller?.reason],
          ["Callback preference", caller?.callback_preference],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "Not provided"}</dd>
          </div>
        ))}
      </dl>
      {caller && (
        <p className="caller-note">
          {caller.consent
            ? "Permission to save contacts recorded"
            : "No contact permission recorded"}{" "}
          · Self-reported details
        </p>
      )}
      {availability && (
        <p>
          <strong>Human support: {availability.status}</strong> ·{" "}
          {availability.timezone}
          {availability.next_open && (
            <>
              {" "}
              · Next opening:{" "}
              {new Date(availability.next_open).toLocaleString("en", {
                timeZone: availability.timezone,
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </>
          )}
        </p>
      )}
      {caller?.handoff && (
        <p role="status">
          <strong>
            {
              {
                transfer_available:
                  "Transfer available on a connected phone call",
                callback_requested: "Callback requested",
                follow_up_requested: "Human follow-up requested",
              }[caller.handoff]
            }
          </strong>
          {caller.ticket_id && <> · Ticket {caller.ticket_id}</>}.{" "}
          {caller.callback_booked === false &&
            "No callback appointment has been booked."}
        </p>
      )}
      {caller?.updated_at && (
        <small>Updated {new Date(caller.updated_at).toLocaleString()}</small>
      )}
    </section>
  );
}
