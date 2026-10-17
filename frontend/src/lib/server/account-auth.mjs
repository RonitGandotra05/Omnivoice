import { mfaStatus, createMfaChallenge } from "./auth-mfa.mjs";
import { beginAuthAttempt, finishAuthAttempt } from "./auth-guard.mjs";
import Google from "next-auth/providers/google";
import { accountProviders, accountView } from "./account-config.mjs";
import {
  verifiedProviderEmail,
  provisionSocialAccount,
} from "./account-identity.mjs";
import { accountRecord } from "./demo-accounts.mjs";
import { protectDemoOperation } from "./demo-protection.mjs";
import { browserOwner } from "./provider.mjs";
const providerFactory = (module) => module.default || module;
export function createAccountAuth(
  request,
  env = process.env,
  onChallenge = () => {},
) {
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
              authorization: {
                params: {
                  scope: "openid email profile",
                  prompt: "select_account",
                },
              },
              profile: (p) => ({
                id: p.sub,
                name: p.name,
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
    pages: { signIn: "/account", error: "/account" },
    callbacks: {
      async signIn({ user, account, profile }) {
        try {
          if (
            account?.provider !== "google" ||
            profile?.sub !== account.providerAccountId
          )
            return "/account?error=VerifiedEmailRequired";
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
              name: profile.name,
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
          const ids = await beginAuthAttempt(request, email, "oauth", env);
          const state = await mfaStatus("public:" + row.id, env);
          if (state.enabled) {
            onChallenge(
              await createMfaChallenge(
                request,
                "public:" + row.id,
                row.session_version,
                "google",
                env,
              ),
            );
            return "/account?mfa=1";
          }
          await finishAuthAttempt(ids, true, env);
          user.accountId = row.id;
          user.accountVersion = row.session_version;
          user.authTime = Math.floor(Date.now() / 1000);
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
            provider: "google",
            accountId: user.accountId,
            accountVersion: user.accountVersion,
            authTime: user.authTime,
            mfaVerified: false,
            mfaVersion: 0,
          };
        return {
          provider: token.provider,
          accountId: token.accountId,
          accountVersion: token.accountVersion,
          authTime: token.authTime,
          mfaVerified: token.mfaVerified === true,
          mfaVersion: token.mfaVersion || 0,
        };
      },
      async session({ session, token }) {
        const account = accountView(
          await accountRecord(token.accountId, token.accountVersion, env),
        );
        const factor = account
          ? await mfaStatus("public:" + account.id, env)
          : null;
        const valid =
          token.provider === "google" &&
          account &&
          (!factor.enabled ||
            (token.mfaVerified === true &&
              token.mfaVersion === factor.version));
        return {
          expires: session.expires,
          user: valid
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
