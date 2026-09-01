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

let cachedVersion = null;
let cachedVersionUntil = 0;

function allowedOrigins(env) {
    return String(env.ALLOWED_ORIGINS || "https://basil-as.github.io,http://localhost:8080")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
}

function corsHeaders(origin, env) {
    const allowed = allowedOrigins(env);
    const responseOrigin = origin ? (allowed.includes(origin) ? origin : null) : allowed[0];
    if (!responseOrigin) return null;
    return {
        "Access-Control-Allow-Origin": responseOrigin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Accept",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

async function getVersionCode() {
    if (cachedVersion && Date.now() < cachedVersionUntil) return cachedVersion;
    try {
        const response = await fetch(`${RUSTORE_ORIGIN}/rustore-info/new-version`, {
            headers: {
                Accept: "application/json",
                ruStoreVerCode: FALLBACK_VERSION_CODE
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        cachedVersion = String(data?.body?.latestVersion || FALLBACK_VERSION_CODE);
    } catch {
        cachedVersion = FALLBACK_VERSION_CODE;
    }
    cachedVersionUntil = Date.now() + 6 * 60 * 60 * 1000;
    return cachedVersion;
}

export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("Origin") || "";
        const cors = corsHeaders(origin, env);

        if (!cors) return new Response("Origin is not allowed", { status: 403, headers: { "Vary": "Origin" } });
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: cors });

        const rawTarget = requestUrl.searchParams.get("url");
        if (!rawTarget) return new Response("Missing url parameter", { status: 400, headers: cors });

        let target;
        try { target = new URL(rawTarget); }
        catch { return new Response("Invalid target URL", { status: 400, headers: cors }); }

        if (target.origin !== RUSTORE_ORIGIN || !ALLOWED_PATHS.some(pattern => pattern.test(target.pathname))) {
            return new Response("Target is not allowed", { status: 403, headers: cors });
        }

        const headers = new Headers();
        headers.set("Accept", "application/json");
        headers.set("ruStoreVerCode", await getVersionCode());
        const contentType = request.headers.get("Content-Type");
        if (contentType) headers.set("Content-Type", contentType);

        const upstream = await fetch(target.toString(), {
            method: request.method,
            headers,
            body: request.method === "POST" ? await request.arrayBuffer() : undefined,
            redirect: "follow"
        });

        const responseHeaders = new Headers(upstream.headers);
        Object.entries(cors).forEach(([key, value]) => responseHeaders.set(key, value));
        responseHeaders.set("Cache-Control", request.method === "GET" ? "public, max-age=60" : "no-store");

        return new Response(upstream.body, {
            status: upstream.status,
            headers: responseHeaders
        });
    }
};
