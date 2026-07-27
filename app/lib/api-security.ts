import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { API_SESSION_COOKIE, API_SESSION_HEADER } from "./api-session";

const GLOBAL_SESSION_KEY = "__chatWebApiSessionToken";

type GlobalWithSession = typeof globalThis & {
  [GLOBAL_SESSION_KEY]?: string;
};

export function withApiSession<T extends NextResponse>(response: T, request?: Request): T {
  const url = request ? new URL(request.url) : null;
  response.cookies.set({
    name: API_SESSION_COOKIE,
    value: getSessionToken(),
    httpOnly: false,
    sameSite: "strict",
    secure: url?.protocol === "https:",
    path: "/",
  });
  return response;
}

export function validateApiMutationRequest(request: Request, options: { requireJson?: boolean } = {}) {
  if (options.requireJson) {
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(request, origin)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  const expectedToken = getSessionToken();
  const cookieToken = readCookie(request.headers.get("cookie"), API_SESSION_COOKIE);
  const headerToken = request.headers.get(API_SESSION_HEADER);
  if (cookieToken !== expectedToken || headerToken !== expectedToken) {
    return NextResponse.json({ error: "Invalid API session." }, { status: 403 });
  }

  return null;
}

function getSessionToken() {
  const globalScope = globalThis as GlobalWithSession;
  if (!globalScope[GLOBAL_SESSION_KEY]) {
    globalScope[GLOBAL_SESSION_KEY] = randomUUID();
  }
  return globalScope[GLOBAL_SESSION_KEY];
}

function isSameOrigin(request: Request, origin: string) {
  if (getAllowedOrigins().includes(origin)) {
    return true;
  }

  try {
    const requestUrl = new URL(request.url);
    const protocol = firstForwardedHeader(request.headers.get("x-forwarded-proto")) || requestUrl.protocol.replace(":", "");
    const host = firstForwardedHeader(request.headers.get("x-forwarded-host")) || request.headers.get("host") || requestUrl.host;
    return origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function getAllowedOrigins() {
  return (process.env.CHAT_WEB_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstForwardedHeader(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return "";
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}
