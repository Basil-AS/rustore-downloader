(() => {
    "use strict";

    const RUSTORE_ORIGIN = "https://backapi.rustore.ru";
    const PUBLIC_WEB_ORIGIN = "https://api.rustore.ru";
    const CLOUDFLARE_WORKER_ORIGIN = "https://rustore-downloader.basil-as.workers.dev";
    const CORSPROXY_ORIGIN = "https://corsproxy.io/";
    const FALLBACK_VERSION_CODE = "110802";
    const VERSION_CACHE_KEY = "rustore:version-code:v7";
    const RESPONSE_CACHE_PREFIX = "rustore:response:v7:";
    const DEFAULT_TIMEOUT_MS = 18000;
    const NO_TRANSPORT_MESSAGE = "Для доступа к RuStore API нужен серверный транспорт. Используйте Cloudflare Workers/Pages, Vercel или укажите CorsProxy API key.";

    let versionCodePromise = null;

    function readSessionCache(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry || Date.now() > entry.expiresAt) {
                sessionStorage.removeItem(key);
                return null;
            }
            return entry.value;
        } catch { return null; }
    }

    function writeSessionCache(key, value, ttlMs) {
        try { sessionStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs })); }
        catch {}
    }

    function combineSignals(...signals) {
        const active = signals.filter(Boolean);
        if (active.length === 0) return undefined;
        if (active.length === 1) return active[0];
        if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
        const controller = new AbortController();
        const abort = () => controller.abort();
        active.forEach(signal => signal.aborted ? abort() : signal.addEventListener("abort", abort, { once: true }));
        return controller.signal;
    }

    function getStoredValue(key) {
        try { return localStorage.getItem(key) || ""; }
        catch { return ""; }
    }

    function currentHostname() {
        const direct = String(window.location?.hostname || "").trim();
        if (direct) return direct;
        try { return new URL(String(window.location?.href || "")).hostname; }
        catch { return ""; }
    }

    function customProxyTemplate() { return window.RUSTORE_PROXY_URL || getStoredValue("rustoreProxyUrl"); }
    function corsProxyKey() { return window.RUSTORE_CORSPROXY_KEY || getStoredValue("rustoreCorsProxyKey"); }

    function sameOriginPlatform() {
        if (window.RUSTORE_USE_SAME_ORIGIN_PROXY) return "same-origin";
        const hostname = currentHostname();
        if (hostname.endsWith(".workers.dev")) return "cloudflare-workers";
        if (hostname.endsWith(".pages.dev")) return "cloudflare-pages";
        if (hostname.endsWith(".vercel.app")) return "vercel";
        return "";
    }

    function isGitHubPages() { return currentHostname() === "basil-as.github.io"; }
    function canUseSameOriginProxy() { return Boolean(sameOriginPlatform()); }

    function customProxyUrl(template, targetUrl) {
        return template.includes("{url}")
            ? template.replace("{url}", encodeURIComponent(targetUrl))
            : `${template}${template.includes("?") ? "&" : "?"}url=${encodeURIComponent(targetUrl)}`;
    }

    function apiPathFromTarget(targetUrl) {
        const target = new URL(targetUrl);
        return `/api${target.pathname}${target.search}`;
    }

    function getTransportMode() {
        const platform = sameOriginPlatform();
        if (platform) return platform;
        if (isGitHubPages()) return "github-pages-via-cloudflare";
        if (customProxyTemplate()) return "custom-worker";
        if (corsProxyKey()) return "corsproxy-key";
        return "unconfigured";
    }

    function transportCandidates(targetUrl, versionCode) {
        const candidates = [];
        if (canUseSameOriginProxy()) candidates.push({ name: "same-origin-api", url: apiPathFromTarget(targetUrl), forwardVersionHeader: true });
        if (isGitHubPages()) candidates.push({ name: "github-pages-cloudflare-api", url: `${CLOUDFLARE_WORKER_ORIGIN}${apiPathFromTarget(targetUrl)}`, forwardVersionHeader: true });

        const custom = customProxyTemplate();
        if (custom) candidates.push({ name: "custom-worker", url: customProxyUrl(custom, targetUrl), forwardVersionHeader: false });

        const key = corsProxyKey();
        if (key) {
            const proxy = new URL(CORSPROXY_ORIGIN);
            proxy.searchParams.set("key", key);
            proxy.searchParams.set("url", targetUrl);
            proxy.searchParams.append("reqHeaders", `ruStoreVerCode:${versionCode}`);
            proxy.searchParams.append("reqHeaders", "Accept:application/json");
            candidates.push({ name: "corsproxy-key", url: proxy.toString(), forwardVersionHeader: false });
        }
        return candidates;
    }

    async function rawProxyFetch(targetUrl, init = {}, { versionCode = FALLBACK_VERSION_CODE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
        const safeInit = init || {};
        const candidates = transportCandidates(targetUrl, versionCode);
        if (candidates.length === 0) throw new Error(NO_TRANSPORT_MESSAGE);
        let lastError;

        for (const candidate of candidates) {
            const timeoutController = new AbortController();
            const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
            try {
                const headers = new Headers(safeInit.headers || {});
                if (!headers.has("Accept")) headers.set("Accept", "application/json");
                if (candidate.forwardVersionHeader) headers.set("ruStoreVerCode", versionCode);
                const response = await fetch(candidate.url, {
                    ...safeInit,
                    headers,
                    signal: combineSignals(safeInit.signal, timeoutController.signal),
                    referrerPolicy: "no-referrer"
                });
                if (response.ok || ![401, 403, 429, 502, 503, 504].includes(response.status)) return response;
                lastError = new Error(`${candidate.name}: HTTP ${response.status}`);
            } catch (error) {
                if (safeInit.signal?.aborted) throw error;
                lastError = error;
            } finally { clearTimeout(timeout); }
        }
        throw lastError || new Error("RuStore API недоступен");
    }

    async function getVersionCode() {
        const cached = readSessionCache(VERSION_CACHE_KEY);
        if (cached) return cached;
        if (versionCodePromise) return versionCodePromise;
        versionCodePromise = (async () => {
            try {
                const response = await rawProxyFetch(`${RUSTORE_ORIGIN}/rustore-info/new-version`, { cache: "no-store" }, { versionCode: FALLBACK_VERSION_CODE, timeoutMs: 9000 });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const value = data?.body?.latestVersion;
                if (!value) throw new Error("latestVersion отсутствует в ответе RuStore");
                const versionCode = String(value);
                writeSessionCache(VERSION_CACHE_KEY, versionCode, 6 * 60 * 60 * 1000);
                return versionCode;
            } catch (error) {
                if (getTransportMode() === "unconfigured") return FALLBACK_VERSION_CODE;
                console.warn(`Не удалось получить версию клиента RuStore. Используется ${FALLBACK_VERSION_CODE}.`, error);
                return FALLBACK_VERSION_CODE;
            } finally { versionCodePromise = null; }
        })();
        return versionCodePromise;
    }

    async function request(path, init = {}, options = {}) {
        const method = String(init?.method || "GET").toUpperCase();
        const targetUrl = path.startsWith("http") ? path : `${RUSTORE_ORIGIN}${path}`;
        const cacheTtlMs = method === "GET" ? (options.cacheTtlMs ?? 5 * 60 * 1000) : 0;
        const cacheKey = `${RESPONSE_CACHE_PREFIX}${targetUrl}`;
        if (cacheTtlMs > 0 && !options.skipCache) {
            const cached = readSessionCache(cacheKey);
            if (cached) return cached;
        }

        const versionCode = await getVersionCode();
        let lastError;
        for (let attempt = 0; attempt < (options.attempts || 2); attempt += 1) {
            try {
                const response = await rawProxyFetch(targetUrl, init, { versionCode, timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
                const text = await response.text();
                let data;
                try { data = text ? JSON.parse(text) : {}; }
                catch { throw new Error(`RuStore вернул не JSON: ${text.slice(0, 180)}`); }
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${data?.message || data?.error?.message || "ошибка запроса"}`);
                if (data?.code && data.code !== "OK") throw new Error(data.message || `RuStore API: ${data.code}`);
                if (cacheTtlMs > 0) writeSessionCache(cacheKey, data, cacheTtlMs);
                return data;
            } catch (error) {
                if (error?.name === "AbortError") throw error;
                lastError = error;
                if (String(error?.message || "").includes("нужен серверный транспорт")) break;
                if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 450));
            }
        }
        throw lastError || new Error("RuStore API недоступен");
    }

    async function publicSuggest(query, signal) {
        const params = new URLSearchParams({ query });
        const url = `${PUBLIC_WEB_ORIGIN}/v1/showcase/web/search/suggests?${params}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(url, { headers: { Accept: "application/json" }, signal: combineSignals(signal, controller.signal), referrerPolicy: "no-referrer" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return { code: "OK", body: data?.suggests || [] };
        } finally { clearTimeout(timeout); }
    }

    const api = {
        getVersionCode,
        getTransportMode,
        isConfigured: () => getTransportMode() !== "unconfigured",
        search(query, pageNumber = 0, pageSize = 18, signal) {
            const params = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: String(pageSize), query });
            return request(`/applicationData/apps?${params}`, { signal }, { cacheTtlMs: 2 * 60 * 1000 });
        },
        async suggest(query, signal) {
            try { return await publicSuggest(query, signal); }
            catch {
                const params = new URLSearchParams({ query });
                return request(`/search/suggest?${params}`, { signal }, { cacheTtlMs: 10 * 60 * 1000 });
            }
        },
        info(packageName, signal) { return request(`/applicationData/overallInfo/${encodeURIComponent(packageName)}`, { signal }, { cacheTtlMs: 15 * 60 * 1000 }); },
        versionHistory(appId, signal) { return request(`/applicationData/allAppVersionWhatsNew/${encodeURIComponent(appId)}`, { signal }, { cacheTtlMs: 15 * 60 * 1000 }); },
        comments(packageName, sortBy = "NEW_FIRST", pageNumber = 0, pageSize = 20, signal) {
            const params = new URLSearchParams({ packageName, sortBy, pageNumber: String(pageNumber), pageSize: String(pageSize) });
            return request(`/comment/comment?${params}`, { signal }, { cacheTtlMs: 3 * 60 * 1000 });
        },
        downloadV2(appId, signal) {
            return request("/applicationData/v2/download-link", {
                method: "POST",
                signal,
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ appId, firstInstall: true, mobileServices: ["GMS", "HMS"], supportedAbis: ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"], screenDensity: 640, supportedLocales: ["ru_RU", "en_US"], sdkVersion: 35, withoutSplits: false, signatureFingerprint: null })
            }, { attempts: 2, timeoutMs: 25000 });
        },
        downloadV1(appId, signal) {
            return request("/applicationData/download-link", {
                method: "POST",
                signal,
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ appId, firstInstall: true })
            }, { attempts: 2, timeoutMs: 25000 });
        }
    };

    window.RuStoreApi = Object.freeze(api);
})();
