(() => {
    "use strict";

    const RUSTORE_ORIGIN = "https://backapi.rustore.ru";
    const PUBLIC_WEB_ORIGIN = "https://api.rustore.ru";
    const EMERGENCY_PROXY = "https://test.cors.workers.dev/?";
    const CORSPROXY_ORIGIN = "https://corsproxy.io/";
    const FALLBACK_VERSION_CODE = "110802";
    const VERSION_CACHE_KEY = "rustore:version-code:v3";
    const RESPONSE_CACHE_PREFIX = "rustore:response:v3:";
    const DEFAULT_TIMEOUT_MS = 18000;

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
        } catch {
            return null;
        }
    }

    function writeSessionCache(key, value, ttlMs) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
        } catch {
            // The application still works when storage is unavailable.
        }
    }

    function combineSignals(...signals) {
        const active = signals.filter(Boolean);
        if (active.length === 0) return undefined;
        if (active.length === 1) return active[0];
        if (typeof AbortSignal.any === "function") return AbortSignal.any(active);

        const controller = new AbortController();
        const abort = () => controller.abort();
        active.forEach(signal => {
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
        });
        return controller.signal;
    }

    function getStoredValue(key) {
        try { return localStorage.getItem(key) || ""; }
        catch { return ""; }
    }

    function customProxyTemplate() {
        return window.RUSTORE_PROXY_URL || getStoredValue("rustoreProxyUrl");
    }

    function corsProxyKey() {
        return window.RUSTORE_CORSPROXY_KEY || getStoredValue("rustoreCorsProxyKey");
    }

    function customProxyUrl(template, targetUrl) {
        return template.includes("{url}")
            ? template.replace("{url}", encodeURIComponent(targetUrl))
            : `${template}${template.includes("?") ? "&" : "?"}url=${encodeURIComponent(targetUrl)}`;
    }

    function canUseSameOriginProxy() {
        return Boolean(
            window.RUSTORE_USE_SAME_ORIGIN_PROXY ||
            window.location.hostname.endsWith(".vercel.app")
        );
    }

    function sameOriginProxyUrl(targetUrl) {
        const target = new URL(targetUrl);
        return `/api${target.pathname}${target.search}`;
    }

    function transportCandidates(targetUrl, versionCode) {
        const candidates = [];

        if (canUseSameOriginProxy()) {
            candidates.push({
                name: "same-origin-api",
                url: sameOriginProxyUrl(targetUrl),
                forwardVersionHeader: true
            });
        }

        const custom = customProxyTemplate();
        if (custom) {
            candidates.push({
                name: "custom-worker",
                url: customProxyUrl(custom, targetUrl),
                forwardVersionHeader: false
            });
        }

        const key = corsProxyKey();
        if (key) {
            const proxy = new URL(CORSPROXY_ORIGIN);
            proxy.searchParams.set("key", key);
            proxy.searchParams.set("url", targetUrl);
            proxy.searchParams.append("reqHeaders", `ruStoreVerCode:${versionCode}`);
            proxy.searchParams.append("reqHeaders", "Accept:application/json");
            candidates.push({
                name: "corsproxy-key",
                url: proxy.toString(),
                forwardVersionHeader: false
            });
        }

        // Emergency fallback for static hosts such as GitHub Pages.
        // A first-party Vercel rewrite or self-hosted Worker is preferred for production.
        candidates.push({
            name: "public-worker-fallback",
            url: `${EMERGENCY_PROXY}${targetUrl}`,
            forwardVersionHeader: true
        });

        return candidates;
    }

    async function rawProxyFetch(targetUrl, init = {}, { versionCode = FALLBACK_VERSION_CODE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
        const safeInit = init || {};
        let lastError;

        for (const candidate of transportCandidates(targetUrl, versionCode)) {
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
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error("Нет доступного транспорта к RuStore API");
    }

    async function getVersionCode() {
        const cached = readSessionCache(VERSION_CACHE_KEY);
        if (cached) return cached;
        if (versionCodePromise) return versionCodePromise;

        versionCodePromise = (async () => {
            try {
                const target = `${RUSTORE_ORIGIN}/rustore-info/new-version`;
                const response = await rawProxyFetch(target, { cache: "no-store" }, {
                    versionCode: FALLBACK_VERSION_CODE,
                    timeoutMs: 9000
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                const value = data?.body?.latestVersion;
                if (!value) throw new Error("latestVersion отсутствует в ответе RuStore");

                const versionCode = String(value);
                writeSessionCache(VERSION_CACHE_KEY, versionCode, 6 * 60 * 60 * 1000);
                return versionCode;
            } catch (error) {
                console.warn(`Не удалось получить версию клиента RuStore. Используется ${FALLBACK_VERSION_CODE}.`, error);
                return FALLBACK_VERSION_CODE;
            } finally {
                versionCodePromise = null;
            }
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
                const response = await rawProxyFetch(targetUrl, init, {
                    versionCode,
                    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
                });

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
            const response = await fetch(url, {
                headers: { Accept: "application/json" },
                signal: combineSignals(signal, controller.signal),
                referrerPolicy: "no-referrer"
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return { code: "OK", body: data?.suggests || [] };
        } finally {
            clearTimeout(timeout);
        }
    }

    const api = {
        getVersionCode,

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

        info(packageName, signal) {
            return request(`/applicationData/overallInfo/${encodeURIComponent(packageName)}`, { signal }, { cacheTtlMs: 15 * 60 * 1000 });
        },

        versionHistory(appId, signal) {
            return request(`/applicationData/allAppVersionWhatsNew/${encodeURIComponent(appId)}`, { signal }, { cacheTtlMs: 15 * 60 * 1000 });
        },

        comments(packageName, sortBy = "NEW_FIRST", pageNumber = 0, pageSize = 20, signal) {
            const params = new URLSearchParams({ packageName, sortBy, pageNumber: String(pageNumber), pageSize: String(pageSize) });
            return request(`/comment/comment?${params}`, { signal }, { cacheTtlMs: 3 * 60 * 1000 });
        },

        downloadV2(appId, signal) {
            return request("/applicationData/v2/download-link", {
                method: "POST",
                signal,
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({
                    appId,
                    firstInstall: true,
                    mobileServices: ["GMS", "HMS"],
                    supportedAbis: ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"],
                    screenDensity: 640,
                    supportedLocales: ["ru_RU", "en_US"],
                    sdkVersion: 35,
                    withoutSplits: false,
                    signatureFingerprint: null
                })
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
