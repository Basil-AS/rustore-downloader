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

function jsonError(status, message) {
    return Response.json(
        { code: "PROXY_ERROR", message },
        {
            status,
            headers: {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            }
        }
    );
}

function routePath(value) {
    if (Array.isArray(value)) return `/${value.join("/")}`;
    return `/${String(value || "")}`;
}

export async function onRequest(context) {
    const request = context.request;
    if (!["GET", "POST"].includes(request.method)) {
        return jsonError(405, "Method not allowed");
    }

    const pathname = routePath(context.params.path);
    if (!ALLOWED_PATHS.some(pattern => pattern.test(pathname))) {
        return jsonError(403, "RuStore API path is not allowed");
    }

    const incomingUrl = new URL(request.url);
    const target = new URL(`${RUSTORE_ORIGIN}${pathname}`);
    target.search = incomingUrl.search;

    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set(
        "ruStoreVerCode",
        request.headers.get("ruStoreVerCode") || FALLBACK_VERSION_CODE
    );

    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);

    try {
        const upstream = await fetch(target.toString(), {
            method: request.method,
            headers,
            body: request.method === "POST" ? await request.arrayBuffer() : undefined,
            redirect: "follow"
        });

        const responseHeaders = new Headers();
        for (const name of ["content-type", "content-language", "etag", "last-modified"]) {
            const value = upstream.headers.get(name);
            if (value) responseHeaders.set(name, value);
        }
        responseHeaders.set("Cache-Control", "no-store");
        responseHeaders.set("X-Content-Type-Options", "nosniff");

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders
        });
    } catch (error) {
        console.error("RuStore upstream request failed", error);
        return jsonError(502, "RuStore upstream request failed");
    }
}
