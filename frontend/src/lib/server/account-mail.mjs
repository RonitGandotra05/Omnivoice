import { reserveAccountMail } from "./auth-notices.mjs";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { databasePool } from "./support-store.mjs";
import { accountMailEnabled } from "./account-config.mjs";
import { ApiError } from "./provider.mjs";
export const accountTokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function sendAccountLink(
  account,
  purpose,
  env = process.env,
  createTransport = nodemailer.createTransport,
) {
  if (!accountMailEnabled(env))
    throw new ApiError(
      "Email delivery is not available yet. Please try again later.",
      503,
    );
  await reserveAccountMail(account.email, env);
  const token = randomBytes(32).toString("base64url");
  const result = await databasePool(env).query(
    `INSERT INTO ov_account_tokens(token_hash,account_id,purpose,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 minutes') ON CONFLICT(account_id,purpose) DO UPDATE SET token_hash=$1,expires_at=NOW()+INTERVAL '30 minutes',created_at=NOW() WHERE ov_account_tokens.created_at<NOW()-INTERVAL '2 minutes' RETURNING token_hash`,
    [accountTokenHash(token), account.id, purpose],
  );
  if (!result.rowCount)
    throw new ApiError(
      "Please wait two minutes before requesting another email.",
      429,
    );
  const link = new URL(
    `/account/${purpose === "verify" ? "verify" : "reset"}`,
    env.PUBLIC_APP_URL,
  );
  // A fragment keeps the single-use token out of request URLs and referrers.
  link.hash = token;
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    requireTLS: Number(env.SMTP_PORT) !== 465,
    tls: { rejectUnauthorized: true },
    auth: env.SMTP_USERNAME
      ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: env.SMTP_FROM,
      to: account.email,
      subject:
        purpose === "verify"
          ? "Verify your OmniVoice email"
          : "Reset your OmniVoice password",
      text: `${purpose === "verify" ? "Verify your email to unlock your 5-minute voice demo." : "Reset your account password."}\n\n${link.toString()}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this message.`,
    });
    if (!result.accepted?.length) throw new Error("Mail not accepted");
  } catch {
    await databasePool(env).query(
      "DELETE FROM ov_account_tokens WHERE token_hash=$1",
      [accountTokenHash(token)],
    );
    throw new ApiError(
      "We could not send the email. Please try again later.",
      503,
    );
  } finally {
    transport.close();
  }
}
