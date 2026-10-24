import { z } from "zod";
import { companyGreeting } from "./company-draft.mjs";
import { ProfileSchema } from "./schema.mjs";

export const fieldLabels = {
  company_information: "Company information / knowledge",
  company_name: "Company name",
  greeting: "Opening greeting",
  instructions: "Business context & conversation style",
  support_email: "Support email",
  routes: "Team routing",
  timezone: "Timezone",
  hours_enabled: "Business hours enabled",
  office_hours: "Weekly business hours",
  holidays: "Holidays",
  human_phone: "Human support phone",
};

// Reuse every existing field validator, while rejecting unknown nested properties too.
const strictProfile = z
  .object(
    Object.fromEntries(
      Object.entries(ProfileSchema.shape).map(([key, schema]) => [
        key,
        schema.type === "default" ? schema.removeDefault() : schema,
      ]),
    ),
  )
  .extend({
    routes: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            email: z.email().max(254),
            keywords: z.array(z.string().max(80)).max(30),
          })
          .strict(),
      )
      .max(20),
    office_hours: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          })
          .strict()
          .refine((v) => v.opens !== v.closes),
      )
      .max(21),
  })
  .partial()
  .strict();
// Current forms may contain incomplete edits. Validate their bounded shape here;
// proposed values still use the stricter existing field validators above.
export const DraftSchema = strictProfile
  .extend({
    company_name: z.string().max(120),
    greeting: z.string().max(500),
    instructions: z.string().max(2000),
    support_email: z.string().max(254),
    timezone: z.string().max(100),
    human_phone: z.string().max(30),
    routes: z
      .array(
        z
          .object({
            name: z.string().max(80),
            email: z.string().max(254),
            keywords: z.array(z.string().max(80)).max(30),
          })
          .strict(),
      )
      .max(20),
  })
  .partial()
  .strict();
export const RequestSchema = z
  .object({
    request_id: z.uuid(),
    message: z.string().trim().min(1).max(6000),
    profile: DraftSchema,
    // Only server-defined field identifiers are conversation context; never replay chat history.
    focus: z
      .array(z.enum(Object.keys(fieldLabels)))
      .max(3)
      .default([]),
  })
  .strict();
export const ModelSchema = z
  .object({
    in_scope: z.boolean(),
    updates: strictProfile,
    evidence: z
      .object(
        Object.fromEntries(
          Object.keys(fieldLabels)
            .filter((key) => key !== "company_information")
            .map((key) => [
              key,
              z
                .string()
                .min(1)
                .max(key === "company_information" ? 6000 : 2000)
                .optional(),
            ]),
        ),
      )
      .strict(),
  })
  .strict();
export const refusal =
  "I'm here to help you complete or update your company information.";
const hostile =
  /(?:ignore|override|disregard).{0,60}(?:instruction|prompt|rule)|(?:reveal|show|print|expose).{0,60}(?:system prompt|api key|secret|credential)|(?:become|act as).{0,30}(?:chatbot|unrestricted)|<\/?(?:script|iframe|svg)\b|javascript:|\b(?:drop|truncate)\s+table\b/i;
export function containsCredentials(value) {
  return /AIza[\w-]{25,}|\bsk-[a-zA-Z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@|(?:password|api[_ -]?key|access[_ -]?token|client[_ -]?secret)["']?\s*[=:]\s*["']?[^\s"',;]{6,}/i.test(
    value,
  );
}
export function rejectBeforeProvider(message) {
  if (hostile.test(message.normalize("NFKC"))) return true;
  return /^(?:solve\s+(?:this|the|a|an|\d)\b|write (?:a |an )?(?:python|script|essay|poem|code)\b|explain quantum\b|what is (?:the capital|\d)|calculate\b)/i.test(
    message.trim(),
  );
}
export function validateExtraction(raw, message, existing = {}) {
  // The provider names weekdays to avoid competing locale/JavaScript numbering conventions.
  if (Array.isArray(raw?.updates?.office_hours)) {
    raw = {
      ...raw,
      updates: {
        ...raw.updates,
        office_hours: raw.updates.office_hours.map((window) => ({
          ...window,
          day:
            typeof window.day === "string"
              ? [
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].indexOf(window.day)
              : window.day,
        })),
      },
    };
  }
  const parsed = ModelSchema.parse(raw);
  if (!parsed.in_scope) return {};
  for (const [key, value] of Object.entries(parsed.updates)) {
    const evidence = parsed.evidence[key];
    if (
      !evidence ||
      !(
        message.includes(evidence) ||
        (key === "instructions" &&
          evidence
            .split(/(?<=[.!?])\s+/u)
            .every((sentence) => message.includes(sentence.trim())))
      ) ||
      hostile.test(JSON.stringify(value)) ||
      hostile.test(evidence)
    )
      throw new Error("Invalid extraction evidence");
  }
  // Free-form fields are copied source excerpts, never generated model prose.
  for (const key of ["instructions", "greeting", "company_information"]) {
    if (parsed.updates[key] !== undefined)
      parsed.updates[key] = parsed.evidence[key];
  }
  for (const key of ["company_name", "support_email", "human_phone"]) {
    const normalize = (value) =>
      key === "human_phone"
        ? value.toLowerCase().replace(/[ ()-]/g, "")
        : value.toLowerCase();
    if (
      parsed.updates[key] &&
      !normalize(parsed.evidence[key]).includes(normalize(parsed.updates[key]))
    )
      throw new Error("Unsupported company value");
  }
  if (parsed.updates.office_hours) {
    const source = parsed.evidence.office_hours.toLowerCase();
    const days = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    let affected = days.flatMap((name, index) =>
      source.includes(name) ? [index] : [],
    );
    if (/weekdays|monday (?:to|through|-) friday/.test(source))
      affected = [0, 1, 2, 3, 4, ...affected];
    if (/weekends/.test(source)) affected.push(5, 6);
    if (/every day|daily|all week/.test(source))
      affected = [0, 1, 2, 3, 4, 5, 6];
    // Allow full initial hours extraction; partial edits must name their day(s).
    if (existing.office_hours?.length && !affected.length)
      throw new Error("Specify which business day to change");
    const changed = parsed.updates.office_hours.filter(
      (window) =>
        !existing.office_hours?.some(
          (old) => JSON.stringify(old) === JSON.stringify(window),
        ),
    );
    if (
      affected.length &&
      changed.some((window) => !affected.includes(window.day))
    )
      throw new Error("Unsupported business day change");
    parsed.updates.office_hours = [
      ...(existing.office_hours || []).filter(
        (window) => !affected.includes(window.day),
      ),
      ...parsed.updates.office_hours.filter(
        (window) => !affected.length || affected.includes(window.day),
      ),
    ].sort((a, b) => a.day - b.day);
  }
  if (parsed.updates.routes) {
    for (const route of parsed.updates.routes) {
      if (
        !parsed.evidence.routes
          .toLowerCase()
          .includes(route.email.toLowerCase()) ||
        !parsed.evidence.routes.toLowerCase().includes(route.name.toLowerCase())
      )
        throw new Error("Unsupported team routing");
    }
    const names = new Set(
      parsed.updates.routes.map((route) => route.name.toLowerCase()),
    );
    parsed.updates.routes = [
      ...(existing.routes || []).filter(
        (route) => !names.has(route.name.toLowerCase()),
      ),
      ...parsed.updates.routes,
    ];
  }
  const { company_information, ...profileUpdates } = parsed.updates;
  return {
    ...strictProfile.parse(profileUpdates),
    ...(company_information !== undefined ? { company_information } : {}),
  };
}
export function followUp(profile) {
  const missing = [
    "company_name",
    "support_email",
    "human_phone",
    "timezone",
  ].filter(
    (k) =>
      !profile[k] ||
      !strictProfile.shape[k].safeParse(profile[k]).success ||
      /(?:example\.com|Acme Commerce)/.test(profile[k]),
  );
  if (!profile.office_hours?.length) missing.push("office_hours");
  return missing.slice(0, 2);
}
// A response can be applied only against the exact form values it was based on.
export function mergeProposal(current, snapshot, updates, selected) {
  const result = { ...current };
  for (const key of selected) {
    if (
      key === "company_information" ||
      !Object.hasOwn(fieldLabels, key) ||
      !Object.hasOwn(updates, key)
    )
      continue;
    if (JSON.stringify(current[key]) !== JSON.stringify(snapshot[key]))
      throw new Error(
        "Your form changed. Review a fresh proposal before applying these changes.",
      );
    result[key] = updates[key];
  }
  if (
    selected.includes("greeting") &&
    updates.company_name &&
    updates.greeting === companyGreeting(updates.company_name) &&
    result.company_name !== updates.company_name
  )
    throw new Error(
      "Select the company name with its greeting so they stay consistent.",
    );
  const approved = strictProfile.parse(
    Object.fromEntries(
      selected
        .filter(
          (key) => key !== "company_information" && Object.hasOwn(updates, key),
        )
        .map((key) => [key, updates[key]]),
    ),
  );
  return { ...result, ...approved };
}

export function mergeCompanyInformation(current, snapshot, updates, selected) {
  if (!selected.includes("company_information")) return undefined;
  if (current !== snapshot)
    throw new Error(
      "Your company information changed. Request a fresh proposal before replacing it.",
    );
  return z.string().min(10).max(6000).parse(updates.company_information);
}
export function completeCompanyProposal(updates, existing, source = "") {
  if (
    Object.keys(updates).length &&
    (updates.company_name || updates.instructions) &&
    source.trim().length >= 10 &&
    !rejectBeforeProvider(source) &&
    !containsCredentials(source) &&
    !/^(?:rename|change|set|correct|we now|our new)\b/i.test(source.trim())
  ) {
    const knowledge = source
      .split("\n")
      .filter(
        (line) =>
          !/^\s*(?:©|copyright\b|get directions\s*$|all rights reserved\b|home\s*[|·]\s*about)/i.test(
            line,
          ),
      )
      .join("\n")
      .trim();
    if (knowledge.length >= 10)
      updates = { ...updates, company_information: knowledge };
  }
  if (!Object.keys(updates).length) return updates;
  const name = updates.company_name || existing.company_name;
  if (
    name &&
    name !== "Acme Commerce" &&
    (!existing.greeting ||
      (updates.company_name &&
        updates.company_name !== existing.company_name) ||
      existing.greeting === companyGreeting(existing.company_name) ||
      existing.greeting.includes("Acme’s AI support assistant")) &&
    !updates.greeting
  )
    return { ...updates, greeting: companyGreeting(name) };
  return updates;
}
