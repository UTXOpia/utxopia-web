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
  // The browser talks to whatever RPC the client config resolves to; if it
  // isn't in connect-src every on-chain read (SNS resolve included) dies as a
  // CSP violation, which the UI can only report as "name not found".
  let rpcOrigin = "";
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
    rpcOrigin = rpcUrl ? new URL(rpcUrl).origin : "";
  } catch {
    rpcOrigin = "";
  }
  const connectSrc = [
    "'self'",
    "https://*.rpcpool.com",
    "wss://*.rpcpool.com",
    rpcOrigin,
    rpcOrigin.replace(/^https:/, "wss:"),
    "https://api.binance.com",
    "https://api.coingecko.com",
    "https://*.helius-rpc.com",
    "https://api.devnet.solana.com",
    "https://api.mainnet-beta.solana.com",
    "https://mempool.space",
    "wss://mempool.space",
    "https://*.amidoggy.xyz",
    // utxopia.com subdomains: api (prod), api-hybrid (devnet+regtest), btc (regtest esplora)
    "https://*.utxopia.com",
    circuitOrigin,
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
