import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import GitHub from "next-auth/providers/github";
import { accountProviders, accountView } from "./account-config.mjs";
import {
  verifiedProviderEmail,
  provisionSocialAccount,
} from "./account-identity.mjs";
import { accountRecord } from "./demo-accounts.mjs";
import { protectDemoOperation } from "./demo-protection.mjs";
import { browserOwner } from "./provider.mjs";
const providerFactory = (module) => module.default || module;
export function createAccountAuth(request, env = process.env) {
  const enabled = accountProviders(env);
  const secure = (
    env.NEXTAUTH_URL ||
    env.PUBLIC_APP_URL ||
    request.url
  ).startsWith("https://");
  return {
    providers: [
      ...(enabled.google
        ? [
            providerFactory(Google)({
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              checks: ["pkce", "state"],
              profile: (p) => ({
                id: p.sub,
                name: p.name,
                email: p.email,
                image: null,
              }),
            }),
          ]
        : []),
      ...(enabled.apple
        ? [
            providerFactory(Apple)({
              clientId: env.APPLE_ID,
              clientSecret: env.APPLE_SECRET,
              checks: ["pkce", "state"],
            }),
          ]
        : []),
      ...(enabled.github
        ? [
            providerFactory(GitHub)({
              clientId: env.GITHUB_ID,
              clientSecret: env.GITHUB_SECRET,
              checks: ["state"],
              profile: (p) => ({
                id: String(p.id),
                name: p.name || p.login,
                email: p.email,
                image: null,
              }),
            }),
          ]
        : []),
    ],
    secret: env.NEXTAUTH_SECRET,
    useSecureCookies: secure,
    session: { strategy: "jwt", maxAge: 86400 },
    jwt: { maxAge: 86400 },
    // Apple returns through a cross-site form POST, so its state and PKCE cookies
    // need SameSite=None. Both remain Secure, HTTP-only, signed and short-lived.
    ...(secure
      ? {
          cookies: Object.fromEntries(
            [
              ["pkceCodeVerifier", "pkce.code_verifier"],
              ["state", "state"],
            ].map(([key, name]) => [
              key,
              {
                name: `__Secure-next-auth.${name}`,
                options: {
                  httpOnly: true,
                  sameSite: "none",
                  secure: true,
                  path: "/",
                  maxAge: 900,
                },
              },
            ]),
          ),
        }
      : {}),
    pages: { signIn: "/account", error: "/account" },
    callbacks: {
      async signIn({ user, account, profile }) {
        try {
          const email = await verifiedProviderEmail(
            account.provider,
            profile,
            account,
          );
          if (!email) return "/account?error=VerifiedEmailRequired";
          const row = await provisionSocialAccount(
            {
              provider: account.provider,
              subject: account.providerAccountId,
              email,
              name: user.name,
              beforeCreate: () =>
                protectDemoOperation(
                  request,
                  browserOwner(request, env).owner,
                  "account",
                  0,
                  env,
                ),
            },
            env,
          );
          user.accountId = row.id;
          user.accountVersion = row.session_version;
          return true;
        } catch (error) {
          return (
            "/account?error=" +
            (error.status === 409 ? "UseOriginalMethod" : "SignInUnavailable")
          );
        }
      },
      async jwt({ token, user }) {
        // No provider access/refresh tokens, picture, or email in the client session.
        if (user)
          return {
            accountId: user.accountId,
            accountVersion: user.accountVersion,
          };
        return {
          accountId: token.accountId,
          accountVersion: token.accountVersion,
        };
      },
      async session({ session, token }) {
        const account = accountView(
          await accountRecord(token.accountId, token.accountVersion, env),
        );
        return {
          expires: session.expires,
          user: account
            ? { id: account.id, name: account.name, email: account.email }
            : null,
        };
      },
      async redirect({ url, baseUrl }) {
        const canonical = new URL(env.PUBLIC_APP_URL || baseUrl).origin;
        try {
          const next = new URL(url, canonical);
          return next.origin === canonical
            ? next.href
            : canonical + "/account/settings";
        } catch {
          return canonical + "/account";
        }
      },
    },
    logger: {
      error(code) {
        console.error(
          "Account sign-in failed:",
          String(code)
            .replace(/[^\w-]/g, "")
            .slice(0, 80),
        );
      },
      warn(code) {
        console.warn(
          "Account sign-in warning:",
          String(code)
            .replace(/[^\w-]/g, "")
            .slice(0, 80),
        );
      },
      debug() {},
    },
    debug: false,
  };
}
