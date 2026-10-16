// Check current account state on every privileged request, not only JWT claims.
export async function activeAdmin(user, lookup) {
  if (!user?.isAdmin || !Number.isSafeInteger(user.id) || user.id <= 0)
    return null;
  const account = await lookup(user.id);
  return account?.is_active === true && account.is_admin === true ? user : null;
}
