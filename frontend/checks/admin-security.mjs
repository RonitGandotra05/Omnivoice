import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import {
  isProductAdmin,
  ADMIN_EMAIL,
} from "../src/lib/server/admin-policy.mjs";
import { handleProductAdmin } from "../src/lib/server/product-admin.mjs";
import { encode } from "next-auth/jwt";
import { handleDemoAccount } from "../src/lib/server/demo-accounts.mjs";
import { sessionCookie } from "../src/lib/server/demo-accounts.mjs";
import { mfaStatus } from "../src/lib/server/auth-mfa.mjs";
import { databasePool } from "../src/lib/server/support-store.mjs";
test("admin policy requires database role and verified canonical identity", () => {
  assert.equal(
    isProductAdmin({
      email: ADMIN_EMAIL,
      email_verified: true,
      is_admin: true,
    }),
    true,
  );
  for (const value of [
    { email: ADMIN_EMAIL, email_verified: true },
    { email: "other@example.com", email_verified: true, is_admin: true },
    { email: ADMIN_EMAIL, email_verified: false, is_admin: true },
  ])
    assert.equal(isProductAdmin(value), false);
});
test(
  "live database administrator boundaries and account controls",
  { skip: process.env.OV_ADMIN_INTEGRATION !== "1" },
  async () => {
    const env = {
      ...dotenv.parse(fs.readFileSync(".env.local")),
      PUBLIC_APP_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
    };
    const pool = databasePool(env);
    const id = randomUUID();
    let admin;
    try {
      admin = (
        await pool.query("SELECT * FROM ov_demo_accounts WHERE is_admin")
      ).rows;
      assert.equal(admin.length, 1);
      admin = admin[0];
      assert.equal(admin.email, ADMIN_EMAIL);
      await pool.query(
        "INSERT INTO ov_demo_accounts(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)",
        [id, "Admin audit " + id, id + "@example.com"],
      );
      const row = (
        await pool.query("SELECT * FROM ov_demo_accounts WHERE id=$1", [id])
      ).rows[0];
      const factor = await mfaStatus("public:" + admin.id, env);
      const cookie = (
        await sessionCookie(admin, new Request(env.PUBLIC_APP_URL), env, {
          mfaVerified: factor.enabled,
          mfaVersion: factor.version,
        })
      ).split(";")[0];
      const jwe = await encode({
        secret: env.NEXTAUTH_SECRET,
        token: {
          provider: "google",
          accountId: admin.id,
          accountVersion: admin.session_version,
          mfaVerified: factor.enabled,
          mfaVersion: factor.version,
          authTime: Math.floor(Date.now() / 1000),
        },
        maxAge: 300,
      });
      const userCookie = (
        await sessionCookie(row, new Request(env.PUBLIC_APP_URL), env)
      ).split(";")[0];
      const req = (section, c = cookie, body, origin = env.PUBLIC_APP_URL) =>
        new Request(env.PUBLIC_APP_URL + "/api/admin/" + section, {
          method: body ? "POST" : "GET",
          headers: {
            Cookie: c,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      const googleRequest = new Request(
        env.PUBLIC_APP_URL + "/api/admin/overview",
        { headers: { Cookie: "next-auth.session-token=" + jwe } },
      );
      assert.equal(
        (await handleProductAdmin(googleRequest, "overview", env)).status,
        200,
      );
      const identity = await handleDemoAccount(
        new Request(env.PUBLIC_APP_URL + "/api/account/session", {
          headers: { Cookie: cookie },
        }),
        "session",
        { ...env, NODE_ENV: "production" },
      );
      assert.equal(identity.status, 200);
      const identityBody = await identity.json();
      assert.equal(identityBody.account.is_admin, true);
      assert.equal(identityBody.allowance.available, false);
      const forgedRole = await encode({
        secret: env.NEXTAUTH_SECRET,
        token: {
          provider: "google",
          accountId: row.id,
          accountVersion: row.session_version,
          is_admin: true,
          isAdmin: true,
          role: "admin",
        },
        maxAge: 300,
      });
      assert.equal(
        (
          await handleProductAdmin(
            new Request(env.PUBLIC_APP_URL + "/api/admin/overview", {
              headers: { Cookie: "next-auth.session-token=" + forgedRole },
            }),
            "overview",
            env,
          )
        ).status,
        403,
      );
      if (factor.enabled) {
        const missingFactor = (
          await sessionCookie(admin, new Request(env.PUBLIC_APP_URL), env)
        ).split(";")[0];
        assert.equal(
          (
            await handleProductAdmin(
              new Request(env.PUBLIC_APP_URL + "/api/admin/overview", {
                headers: { Cookie: missingFactor },
              }),
              "overview",
              env,
            )
          ).status,
          401,
        );
      }
      if (process.env.OV_ADMIN_HTTP === "1") {
        const root = "http://127.0.0.1:3000";
        assert.equal(
          (
            await fetch(root + "/api/admin/overview", {
              headers: { Cookie: cookie },
            })
          ).status,
          200,
        );
        const ordinaryPage = await fetch(root + "/admin/dashboard", {
          headers: { Cookie: userCookie },
          redirect: "manual",
        });
        assert.equal(ordinaryPage.status, 307);
        assert.equal(
          new URL(ordinaryPage.headers.get("location"), root).pathname,
          "/",
        );
        assert.equal(
          (
            await fetch(root + "/admin/dashboard", {
              headers: { Cookie: cookie },
              redirect: "manual",
            })
          ).status,
          200,
        );
      }
      for (const section of ["overview", "accounts"]) {
        assert.equal(
          (await handleProductAdmin(req(section, ""), section, env)).status,
          401,
        );
        assert.equal(
          (await handleProductAdmin(req(section, userCookie), section, env))
            .status,
          403,
        );
        assert.equal(
          (
            await handleProductAdmin(
              req(section, "ov_account=forged"),
              section,
              env,
            )
          ).status,
          401,
        );
        const result = await handleProductAdmin(req(section), section, env);
        assert.equal(result.status, 200, await result.clone().text());
        assert.match(result.headers.get("cache-control"), /no-store/);
      }
      assert.equal(
        (
          await handleProductAdmin(
            req(
              "accounts",
              cookie,
              { id, action: "suspend" },
              "https://evil.example",
            ),
            "accounts",
            env,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleProductAdmin(
            req("accounts", cookie, { id, action: "restore", is_admin: true }),
            "accounts",
            env,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await handleProductAdmin(
            req("accounts", cookie, { id: admin.id, action: "suspend" }),
            "accounts",
            env,
          )
        ).status,
        403,
      );
      for (const action of ["suspend", "restore", "revoke"]) {
        const result = await handleProductAdmin(
          req("accounts", cookie, { id, action }),
          "accounts",
          env,
        );
        assert.equal(result.status, 200, await result.clone().text());
        const updated = (
          await pool.query("SELECT * FROM ov_demo_accounts WHERE id=$1", [id])
        ).rows[0];
        assert.equal(updated.active, action !== "suspend");
        assert.equal(updated.is_admin, false);
      }
      assert.equal(
        (await handleProductAdmin(req("overview", userCookie), "overview", env))
          .status,
        401,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS n FROM ov_admin_events WHERE target=$1",
            [id],
          )
        ).rows[0].n,
        3,
      );
      await assert.rejects(
        pool.query("UPDATE ov_demo_accounts SET is_admin=TRUE WHERE id=$1", [
          id,
        ]),
        (e) => e.code === "23514" || e.code === "23505",
      );
    } finally {
      await pool.query("DELETE FROM ov_admin_events WHERE target=$1", [id]);
      await pool.query("DELETE FROM ov_demo_accounts WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
