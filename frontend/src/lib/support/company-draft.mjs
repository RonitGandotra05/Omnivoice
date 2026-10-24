import { initialProfile, initialDocuments } from "../workspace.mjs";

export const emptyCompanyProfile = () => ({
  company_name: "",
  greeting: "",
  instructions: "",
  support_email: "",
  timezone: "UTC",
  hours_enabled: false,
  office_hours: [],
  holidays: [],
  human_phone: "",
  routes: [],
});
export const companyGreeting = (name) =>
  `Hi, I'm ${name}'s AI support assistant. How can I help today?`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function isSampleField(key, value) {
  return Object.hasOwn(initialProfile, key) && same(initialProfile[key], value);
}
// Migrate only exact shipped examples. Edited documents, custom greetings, routes,
// and schedules remain intact. No policy is generated to replace sample knowledge.
export function removeCompanySamples(state) {
  const profile = state.profile;
  if (!profile) return false;
  let changed = false;
  const legacy =
    profile.company_name === initialProfile.company_name ||
    profile.greeting === initialProfile.greeting;
  for (const key of ["company_name", "support_email"]) {
    if (isSampleField(key, profile[key])) {
      profile[key] = "";
      changed = true;
    }
  }
  if (profile.greeting === initialProfile.greeting) {
    profile.greeting = profile.company_name
      ? companyGreeting(profile.company_name)
      : "";
    changed = true;
  }
  const routes = (profile.routes || []).filter(
    (route) => !initialProfile.routes.some((sample) => same(sample, route)),
  );
  if (routes.length !== (profile.routes || []).length) {
    profile.routes = routes;
    changed = true;
  }
  if (legacy && same(profile.office_hours, initialProfile.office_hours)) {
    profile.office_hours = [];
    profile.hours_enabled = false;
    changed = true;
  }
  const documents = (state.documents || []).filter(
    (doc) =>
      !initialDocuments.some(
        (sample) =>
          doc.id === sample.id &&
          doc.name === sample.name &&
          doc.content === sample.content,
      ),
  );
  if (documents.length !== (state.documents || []).length) {
    state.documents = documents;
    changed = true;
  }
  if (changed) {
    if (state.agentToken)
      state.retiredAgents = [
        ...new Set([...(state.retiredAgents || []), state.agentToken]),
      ].slice(-8);
    state.agentToken = null;
    state.publish = {
      status: "not_published",
      result: { needs_publish: true },
    };
  }
  return changed;
}
