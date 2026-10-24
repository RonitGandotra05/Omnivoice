// Require both a database role and the verified canonical identity.
export const ADMIN_EMAIL = "ronitgandotra@gmail.com";
export function isProductAdmin(account) {
  return (
    account?.is_admin === true &&
    account.email_verified === true &&
    account.email?.trim().toLowerCase() === ADMIN_EMAIL
  );
}
