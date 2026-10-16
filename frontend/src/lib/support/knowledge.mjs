import { parse, ChecksSchema } from "./schema.mjs";
const STOP = new Set(
  "a an the is are do does i my me you your we our to for of and or in on it can could would please tell about what when how have has with be at this that there".split(
    " ",
  ),
);
const SYN = {
  open: "hours",
  opening: "hours",
  close: "hours",
  closed: "hours",
  closing: "hours",
  refunds: "refund",
  returns: "return",
  pricing: "price",
  cost: "price",
  costs: "price",
  prices: "price",
  delivery: "shipping",
  deliver: "shipping",
};
export function tokens(value) {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((t) => !STOP.has(t))
      .map((t) => SYN[t] || t),
  );
}
export function routeTicket(profile, text) {
  const terms = tokens(text);
  const ranked = profile.routes
    .map((r, i) => ({
      r,
      i,
      score: r.keywords.filter((k) => [...tokens(k)].some((t) => terms.has(t)))
        .length,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return ranked[0]?.score
    ? { team: ranked[0].r.name, recipient: ranked[0].r.email }
    : { team: "Support", recipient: profile.support_email };
}
export function passages(documents) {
  return documents
    .filter((d) => d.status !== "needs_review")
    .flatMap((doc) =>
      doc.content.split(/\n\s*\n/).flatMap((p) => {
        const result = [];
        for (let start = 0; start < p.length; start += 780) {
          const excerpt = p.slice(start, start + 900).trim();
          result.push({ document: doc.name, excerpt, words: tokens(excerpt) });
        }
        return result;
      }),
    );
}
export function answer(query, profile, documents, prepared) {
  const terms = tokens(query);
  let sources = [];
  if (
    terms.size &&
    !/\b(human|person|manager|representative|supervisor|escalat\w*|complaint|complain|call me|speak to|talk to)\b/i.test(
      query,
    )
  )
    sources = (prepared || passages(documents))
      .map((p) => ({
        ...p,
        score: [...terms].filter((t) => p.words.has(t)).length / terms.size,
      }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  if (!sources.length || sources[0].score < 0.5) sources = [];
  return {
    response: sources.length
      ? `According to ${sources[0].document}: ${sources[0].excerpt}`
      : "I don't have a verified answer in the company documents. I can create a request for the team to follow up.",
    sources: sources.map(({ document, excerpt, score }) => ({
      document,
      excerpt,
      score: Math.round(score * 1000) / 1000,
    })),
    needs_escalation: !sources.length,
    routing: sources.length ? null : routeTicket(profile, query),
    mode: "document_search",
  };
}
const normalized = (v) =>
  v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function evaluateChecks(profile, documents, values) {
  const cases = parse(ChecksSchema, values);
  const prepared = cases.length ? passages(documents) : [];
  const results = cases.map((c) => {
    const out = answer(c.query, profile, documents, prepared);
    const reasons = [];
    if (out.needs_escalation !== c.expect_escalation)
      reasons.push(
        c.expect_escalation
          ? "Expected a human handoff."
          : "Expected a grounded answer.",
      );
    if (!c.expect_escalation && !out.sources.length)
      reasons.push("No supporting source was found.");
    if (
      c.expected_phrases.some(
        (p) => !normalized(out.response).includes(normalized(p)),
      )
    )
      reasons.push("An expected answer phrase was missing.");
    if (
      c.expected_document &&
      !out.sources.some(
        (s) => normalized(s.document) === normalized(c.expected_document),
      )
    )
      reasons.push("The expected source document was not used.");
    if (
      c.expected_team &&
      normalized(out.routing?.team || "") !== normalized(c.expected_team)
    )
      reasons.push("The handoff reached a different team.");
    return {
      name: c.name,
      status: reasons.length ? "failed" : "passed",
      reasons,
      response: out.response,
      sources: out.sources.map((s) => s.document),
      needs_escalation: out.needs_escalation,
      team: out.routing?.team,
    };
  });
  const passed = results.filter((r) => r.status === "passed").length;
  return {
    status: !cases.length
      ? "not_run"
      : passed === cases.length
        ? "passed"
        : "failed",
    passed,
    failed: cases.length - passed,
    total: cases.length,
    results,
    scope: "local_document_search",
    voice_tested: false,
    checked_at: new Date().toISOString(),
  };
}
