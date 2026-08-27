import { SignJWT } from "jose";

if (process.env.NODE_ENV === "production") throw new Error("This local-only helper must not run in production");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const secret = required("JWT_SECRET");
const organizationId = required("DEV_ORG_ID");
const userId = required("DEV_USER_ID");
const issuer = required("JWT_ISSUER");
const audience = required("JWT_AUDIENCE");
const role = process.env.DEV_ROLE ?? "admin";
if (role !== "admin" && role !== "member") throw new Error("DEV_ROLE must be admin or member");

const token = await new SignJWT({ org_id: organizationId, role })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuer(issuer)
  .setAudience(audience)
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(secret));

process.stdout.write(token);
