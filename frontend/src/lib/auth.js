import { jwtVerify, SignJWT } from "jose";
const key = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  if (
    process.env.JWT_SECRET.length < 32 ||
    /change-me|replace-with|example/i.test(process.env.JWT_SECRET)
  )
    throw new Error("JWT_SECRET must be a strong private value");
  return new TextEncoder().encode(process.env.JWT_SECRET);
};
export async function signAuthToken(user) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    isAdmin: Boolean(user.is_admin),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key());
}
export async function verifyAuthToken(token) {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
    });
    return {
      id: payload.id,
      email: payload.email,
      isAdmin: payload.isAdmin === true,
      role: payload.isAdmin === true ? "admin" : "user",
    };
  } catch {
    return null;
  }
}
