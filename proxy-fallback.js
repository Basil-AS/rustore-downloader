(() => {
    "use strict";

    const PROXY_ORIGIN = "https://corsproxy.io";
    const originalFetch = window.fetch.bind(window);

    function getVersionCode(url) {
        return url.searchParams
            .getAll("reqHeaders")
            .map(value => String(value))
            .find(value => value.toLowerCase().startsWith("rustorevercode:"))
            ?.split(":")
            .slice(1)
            .join(":")
            .trim();
    }

    window.fetch = async function proxyCompatibleFetch(input, init) {
        const request = input instanceof Request ? input : null;
        const requestBackup = request ? request.clone() : null;
        const rawUrl = request ? request.url : String(input);
        const url = new URL(rawUrl, window.location.href);

        if (url.origin !== PROXY_ORIGIN || !url.searchParams.has("url")) {
            return originalFetch(input, init);
        }

        const response = await originalFetch(input, init);
        const versionCode = getVersionCode(url);

        if (!versionCode || ![400, 401, 403].includes(response.status)) {
            return response;
        }

        const fallbackUrl = new URL(`${PROXY_ORIGIN}/`);
        fallbackUrl.searchParams.set("url", url.searchParams.get("url"));

        const safeInit = init || {};
        const headers = new Headers(requestBackup?.headers);
        new Headers(safeInit.headers || {}).forEach((value, name) => headers.set(name, value));
        headers.set("Accept", "application/json");
        headers.set("ruStoreVerCode", versionCode);

        const fallbackInit = {
            ...safeInit,
            headers,
            referrerPolicy: "no-referrer"
        };

        console.info("CorsProxy URL header override was rejected; retrying with a forwarded request header.");

        if (requestBackup) {
            return originalFetch(new Request(requestBackup, fallbackInit));
        }

        return originalFetch(fallbackUrl.toString(), fallbackInit);
    };
})();
