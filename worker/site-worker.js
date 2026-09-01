const RUSTORE_ORIGIN = "https://backapi.rustore.ru";
const FALLBACK_VERSION_CODE = "110802";

const ALLOWED_PATHS = [
  /^\/rustore-info\/new-version$/,
  /^\/applicationData\/apps$/,
  /^\/search\/suggest$/,
  /^\/applicationData\/overallInfo\/[A-Za-z0-9._-]+$/,
  /^\/applicationData\/allAppVersionWhatsNew\/\d+$/,
  /^\/applicationData\/(?:v2\/)?download-link$/,
  /^\/comment\/comment$/
];

function jsonError(message, status) {
  return new Response(JSON.stringify({ code: "ERROR", message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function handleApi(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonError("Method not allowed", 405);
  }

  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.slice(4) || "/";
  if (!ALLOWED_PATHS.some(pattern => pattern.test(upstreamPath))) {
    return jsonError("Endpoint not allowed", 403);
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
    return jsonError("RuStore API unavailable", 502);
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
