import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Allowed origins for API requests (env var is comma-separated) */
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_BASE_URL || ""
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function isSameOrigin(origin: string | null, requestOrigin: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(requestOrigin).origin;
  } catch {
    return false;
  }
}

export function requestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function isAllowedOrigin(origin: string | null, requestOrigin: string): boolean {
  if (!origin) return true; // Same-origin requests have no Origin header
  // Browsers include Origin on same-origin POST requests. Trust the URL the
  // request actually reached before consulting the cross-origin allowlist.
  if (isSameOrigin(origin, requestOrigin)) return true;
  if (ALLOWED_ORIGINS.length === 0) {
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }
  return ALLOWED_ORIGINS.some(
    (allowed) => origin === allowed || origin === allowed.replace(/\/$/, "")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");
  const servedOrigin = requestOrigin(request);

  if (pathname.startsWith("/api/")) {
    if (!isAllowedOrigin(origin, servedOrigin)) {
      return NextResponse.json(
        { success: false, error: "Forbidden: origin not allowed" },
        { status: 403 }
      );
    }

    if (request.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      if (origin && isAllowedOrigin(origin, servedOrigin)) {
        res.headers.set("Access-Control-Allow-Origin", origin);
        res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.headers.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
        res.headers.set("Access-Control-Max-Age", "86400");
      }
      return res;
    }

    const response = NextResponse.next();
    if (origin && isAllowedOrigin(origin, servedOrigin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    addSecurityHeaders(response);
    return response;
  }

  const response = NextResponse.next();
  addSecurityHeaders(response);
  return response;
}

function addSecurityHeaders(response: NextResponse) {
  const isDev = process.env.NODE_ENV !== "production";
  const circuitCdnUrl = process.env.NEXT_PUBLIC_CIRCUIT_CDN_URL || "";
  let circuitOrigin = "";
  try {
    circuitOrigin = circuitCdnUrl ? new URL(circuitCdnUrl).origin : "";
  } catch {
    circuitOrigin = "";
  }
  // Browser RPC reads go through /api/rpc, which 'self' already covers.
  // Websockets can't be proxied, so that host does need naming — along with
  // NEXT_PUBLIC_SOLANA_RPC_URL for deployments still pointing the browser
  // straight at an RPC. Miss either and reads die as CSP violations, which the
  // UI can only report as "name not found".
  // Social login talks to Privy from the browser, and its embedded wallet runs
  // in an iframe served from the same origin — so this is one host in two
  // directives, and missing either kills sign-in with a console error the UI
  // never sees. Gated on the app id: a deployment with no Privy configured
  // widens nothing, which is the only reason it is safe to name a host that,
  // by design, is allowed to receive whatever the page will hand it.
  const privyOrigins = process.env.NEXT_PUBLIC_PRIVY_APP_ID
    ? ["https://auth.privy.io", "https://api.privy.io"]
    : [];

  const wsOrigins: string[] = [];
  for (const value of [process.env.NEXT_PUBLIC_SOLANA_WS_URL, process.env.NEXT_PUBLIC_SOLANA_RPC_URL]) {
    if (!value) continue;
    try {
      const { origin } = new URL(value);
      wsOrigins.push(origin, origin.replace(/^http/, "ws"));
    } catch {
      // Malformed env value — nothing to allow.
    }
  }
  const connectSrc = [
    "'self'",
    "https://*.rpcpool.com",
    "wss://*.rpcpool.com",
    ...wsOrigins,
    "https://api.binance.com",
    "https://api.coingecko.com",
    "https://*.helius-rpc.com",
    "https://api.devnet.solana.com",
    "wss://api.devnet.solana.com",
    "https://api.mainnet-beta.solana.com",
    "wss://api.mainnet-beta.solana.com",
    "https://mempool.space",
    "wss://mempool.space",
    // Named hosts, not `*.utxopia.com`. A wildcard here trusts every subdomain the org will
    // ever have, including one lost to a dangling DNS record — and this is the page that holds
    // spending keys, so an allowed origin is an exfiltration route. Add hosts deliberately.
    "https://api.utxopia.com",          // prod backend
    "https://api-regtest.utxopia.com",  // Solana devnet + regtest BTC backend
    "https://api-hybrid.utxopia.com",   // the same backend's retired name; drop with the route
    "https://api-testnet4.utxopia.com", // Solana devnet + testnet4 BTC backend
    "https://btc.utxopia.com",          // regtest esplora
    "https://circuit.utxopia.com",      // circuit artifact CDN
    circuitOrigin,
    ...privyOrigins,
  ]
    .filter(Boolean)
    .join(" ");

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src ${connectSrc}`,
      // default-src would otherwise hold this to 'self' and blank the embedded
      // wallet's iframe.
      `frame-src 'self'${privyOrigins.length ? " https://auth.privy.io" : ""}`,
      "frame-ancestors 'none'",
    ].join("; ")
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
