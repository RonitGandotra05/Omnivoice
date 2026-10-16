import { z } from "zod";
const text = (min, max) => z.string().trim().min(min).max(max);
const email = z.email().max(254);
const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const ProfileSchema = z.object({
  company_name: text(2, 120),
  greeting: text(2, 500),
  instructions: z.string().max(2000),
  support_email: email,
  routes: z
    .array(
      z.object({
        name: text(1, 80),
        email,
        keywords: z
          .array(text(0, 80))
          .max(30)
          .transform((v) => [
            ...new Set(v.map((k) => k.toLowerCase()).filter(Boolean)),
          ]),
      }),
    )
    .max(20),
  timezone: z
    .string()
    .max(100)
    .default("UTC")
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use a valid IANA timezone"),
  hours_enabled: z.boolean().default(false),
  office_hours: z
    .array(
      z
        .object({
          day: z.number().int().min(0).max(6),
          opens: clock,
          closes: clock,
        })
        .refine(
          (w) => w.opens !== w.closes,
          "Opening and closing times must differ",
        ),
    )
    .max(21)
    .default([]),
  holidays: z
    .array(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (v) =>
            Number.isFinite(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v,
          "Invalid holiday date",
        ),
    )
    .max(60)
    .default([]),
  human_phone: z
    .string()
    .regex(/^(|\+[1-9][0-9]{7,14})$/)
    .default(""),
});
export const DocumentSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: text(1, 255),
  content: text(10, 200000),
  status: z.enum(["ready", "needs_review"]).default("ready"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  fingerprint: z.string().max(64).optional(),
});
export const DocumentsSchema = z
  .array(DocumentSchema)
  .max(100)
  .refine(
    (d) => d.reduce((n, v) => n + v.content.length, 0) <= 5000000,
    "Workspace exceeds 5,000,000 characters",
  );
export const CallerSchema = z
  .object({
    action: z.enum(["availability", "capture", "handoff"]).default("capture"),
    conversation_id: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
    name: text(0, 120).default(""),
    phone: z
      .string()
      .max(30)
      .default("")
      .transform((v) => v.replace(/[ ()-]/g, ""))
      .refine(
        (v) => !v || /^\+[1-9][0-9]{7,14}$/.test(v),
        "Confirm a phone number with + and country code",
      ),
    email: email.nullable().optional().default(null),
    reason: text(0, 2000).default(""),
    consent: z.boolean().default(false),
    callback_requested: z.boolean().default(false),
    human_requested: z.boolean().default(false),
    callback_preference: text(0, 300).default(""),
  })
  .refine(
    (v) => v.consent || !(v.name || v.phone || v.email),
    "Permission is required before saving contact details",
  );
export const TicketSchema = z.object({
  subject: text(3, 160).refine(
    (v) => !/[\x00-\x1f\x7f]/.test(v),
    "Subject must be a single line",
  ),
  summary: text(10, 4000),
  customer_email: email.nullable().optional().default(null),
  customer_phone: z.string().max(30).default(""),
  transcript: z.string().max(20000).default(""),
  priority: z.enum(["normal", "high"]).default("normal"),
  idempotency_key: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
});
const CaseSchema = z
  .object({
    name: text(1, 100),
    query: text(2, 2000),
    expect_escalation: z.boolean().default(false),
    expected_phrases: z.array(text(1, 200)).max(5).default([]),
    expected_document: text(1, 255).nullable().optional().default(null),
    expected_team: text(1, 80).nullable().optional().default(null),
  })
  .refine(
    (v) =>
      v.expect_escalation || v.expected_phrases.length || v.expected_document,
    "An answer check needs an expected phrase or document",
  )
  .refine(
    (v) => !v.expected_team || v.expect_escalation,
    "A team expectation requires a handoff check",
  );
export const ChecksSchema = z
  .array(CaseSchema)
  .max(25)
  .refine(
    (v) =>
      new Set(v.map((c) => c.name.normalize("NFKC").toLowerCase())).size ===
      v.length,
    "Check names must be unique",
  );
export function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const error = new Error(r.error.issues.map((i) => i.message).join("; "));
    error.status = 422;
    throw error;
  }
  return r.data;
}
