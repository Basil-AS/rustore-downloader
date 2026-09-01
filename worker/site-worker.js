const RUSTORE_ORIGIN = "https://backapi.rustore.ru";
const FALLBACK_VERSION_CODE = "110802";
const ALLOWED_CORS_ORIGINS = new Set([
  "https://basil-as.github.io",
  "http://localhost:8080"
]);

const ALLOWED_PATHS = [
  /^\/rustore-info\/new-version$/,
  /^\/applicationData\/apps$/,
  /^\/search\/suggest$/,
  /^\/applicationData\/overallInfo\/[A-Za-z0-9._-]+$/,
  /^\/applicationData\/allAppVersionWhatsNew\/\d+$/,
  /^\/applicationData\/(?:v2\/)?download-link$/,
  /^\/comment\/comment$/
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin || !ALLOWED_CORS_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Accept,Content-Type,ruStoreVerCode",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function applyCors(headers, cors) {
  if (!cors) return;
  Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
}

function jsonError(message, status, cors = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  applyCors(headers, cors);
  return new Response(JSON.stringify({ code: "ERROR", message }), { status, headers });
}

async function handleApi(request) {
  const cors = corsHeaders(request);
  const origin = request.headers.get("Origin") || "";

  if (request.method === "OPTIONS") {
    if (origin && !cors) return jsonError("Origin not allowed", 403);
    return new Response(null, { status: 204, headers: cors || {} });
  }

  if (origin && !cors && new URL(request.url).origin !== origin) {
    return jsonError("Origin not allowed", 403);
  }

  if (!["GET", "POST"].includes(request.method)) {
    return jsonError("Method not allowed", 405, cors);
  }

  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.slice(4) || "/";
  if (!ALLOWED_PATHS.some(pattern => pattern.test(upstreamPath))) {
    return jsonError("Endpoint not allowed", 403, cors);
  }

  const target = new URL(`${upstreamPath}${incoming.search}`, RUSTORE_ORIGIN);
  const requestedVersion = request.headers.get("ruStoreVerCode") || "";
  const versionCode = /^\d{4,9}$/.test(requestedVersion)
    ? requestedVersion
    : FALLBACK_VERSION_CODE;

  const headers = new Headers({
    Accept: "application/json",
    ruStoreVerCode: versionCode
  });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      redirect: "follow"
    });
  } catch {
    return jsonError("RuStore API unavailable", 502, cors);
  }

  const responseHeaders = new Headers();
  responseHeaders.set(
    "Content-Type",
    upstream.headers.get("Content-Type") || "application/json; charset=utf-8"
  );
  responseHeaders.set(
    "Cache-Control",
    request.method === "GET" ? "public, max-age=60" : "no-store"
  );
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  applyCors(responseHeaders, cors);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request);
    }
    return env.ASSETS.fetch(request);
  }
};
