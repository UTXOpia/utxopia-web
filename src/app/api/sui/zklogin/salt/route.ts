import { createHmac, createPublicKey, createVerify } from "node:crypto";
import { NextResponse } from "next/server";

const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export async function POST(request: Request) {
  const secret = process.env.ZKLOGIN_SALT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ZKLOGIN_SALT_SECRET is not configured" },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null) as { jwt?: string } | null;
  const jwt = body?.jwt;
  if (!jwt) {
    return NextResponse.json({ error: "jwt is required" }, { status: 400 });
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifyJwt(jwt);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "JWT verification failed" },
      { status: 401 },
    );
  }
  const issuer = stringClaim(claims.iss);
  const subject = stringClaim(claims.sub);
  const audience = Array.isArray(claims.aud)
    ? claims.aud.map(stringClaim).join(",")
    : stringClaim(claims.aud);

  if (!issuer || !subject || !audience) {
    return NextResponse.json({ error: "JWT missing iss, sub, or aud" }, { status: 400 });
  }

  const saltHex = createHmac("sha256", secret)
    .update("utxopia:sui:zklogin:salt:v1")
    .update("\0")
    .update(issuer)
    .update("\0")
    .update(audience)
    .update("\0")
    .update(subject)
    .digest("hex");
  const salt = (BigInt(`0x${saltHex}`) % BN254_FIELD).toString(10);

  return NextResponse.json({ salt });
}

// Verify the OIDC JWT: RS256 signature against the issuer's JWKS, plus exp/iat
// and (optional) audience allowlist. Prevents the salt endpoint from acting as a
// free HMAC oracle for forged, unsigned JWTs.
async function verifyJwt(jwt: string): Promise<Record<string, unknown>> {
  const [headerB64, payloadB64, sigB64] = jwt.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Invalid JWT");

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;

  if (header.alg !== "RS256") throw new Error("Unsupported JWT alg");

  const iss = stringClaim(claims.iss);
  if (!iss || !/^https:\/\//.test(iss)) throw new Error("JWT missing/invalid iss");

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) throw new Error("JWT expired");
  if (typeof claims.iat === "number" && claims.iat > now + 300) throw new Error("JWT iat in the future");

  const allowedAud = process.env.ZKLOGIN_ALLOWED_AUD;
  if (allowedAud) {
    const auds = Array.isArray(claims.aud) ? claims.aud.map(stringClaim) : [stringClaim(claims.aud)];
    const allowed = new Set(allowedAud.split(",").map((a) => a.trim()));
    if (!auds.some((a) => allowed.has(a))) throw new Error("JWT aud not allowed");
  }

  const discovery = await fetch(`${iss.replace(/\/$/, "")}/.well-known/openid-configuration`)
    .then((r) => r.json() as Promise<{ jwks_uri?: string }>);
  if (!discovery.jwks_uri) throw new Error("Issuer has no jwks_uri");
  type Jwk = { kid?: string; [k: string]: unknown };
  const jwks = await fetch(discovery.jwks_uri).then((r) => r.json() as Promise<{ keys?: Jwk[] }>);
  const jwk = jwks.keys?.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("JWT signing key not found in JWKS");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pubKey = createPublicKey({ key: jwk as any, format: "jwk" });
  const ok = createVerify("RSA-SHA256")
    .update(`${headerB64}.${payloadB64}`)
    .verify(pubKey, Buffer.from(sigB64, "base64url"));
  if (!ok) throw new Error("JWT signature verification failed");

  return claims;
}

function stringClaim(value: unknown): string {
  return typeof value === "string" ? value : "";
}
