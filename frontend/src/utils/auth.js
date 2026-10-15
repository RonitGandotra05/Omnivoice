import { verifyAuthToken } from "@/lib/auth";
export async function verifyToken(token) {
  const user = await verifyAuthToken(token);
  return user?.isAdmin ? user : null;
}
