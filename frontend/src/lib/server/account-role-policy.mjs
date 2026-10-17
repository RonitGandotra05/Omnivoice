import { ApiError } from "./provider.mjs";

const protectedFields = new Set([
  "role",
  "roles",
  "admin",
  "isadmin",
  "issuperuser",
  "superuser",
  "permissions",
  "privileges",
  "scopes",
  "accesslevel",
  "accounttype",
  "userrole",
  "accountrole",
  "roleid",
  "issuperadmin",
]);

// Account privileges are database-managed. Reject attempted mass assignment,
// including alternate casing/separators, even from an authenticated operator.
export function assertDatabaseManagedRoles(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  for (const key of Object.keys(body)) {
    if (protectedFields.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase()))
      throw new ApiError(
        "Account roles and permissions are managed directly in the database.",
        403,
      );
    if (body[key] && typeof body[key] === "object") {
      if (Array.isArray(body[key])) {
        for (const item of body[key]) assertDatabaseManagedRoles(item);
      } else assertDatabaseManagedRoles(body[key]);
    }
  }
}
