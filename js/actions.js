import { api, PACKAGE_RE, detailsCache, state, dom, $, escapeHtml, formatDate, formatNumber, mergeApp, deduplicateApps } from "./common.js";
import { setStatus, emptyState, loadingState, showError, cardMarkup, showModal } from "./render.js";

const SEARCH_PAGE_SIZE = 12;
const MAX_VISIBLE_PER_PAGE = 8;

function normalizeSearch(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
}

function searchTokens(value) {
    return normalizeSearch(value).split(/[^\p{L}\p{N}._-]+/u).filter(token => token.length >= 2);
}

function relevanceScore(app, query) {
    const q = normalizeSearch(query);
    const name = normalizeSearch(app.appName);
    const pkg = normalizeSearch(app.packageName);
    const description = normalizeSearch(app.shortDescription);
    if (!q) return 0;
    if (pkg === q) return 10000;
    if (name === q) return 9500;
    if (name.startsWith(q)) return 8000;
    if (pkg.startsWith(q)) return 7600;
    if (name.includes(q)) return 6500;
    if (pkg.includes(q)) return 6200;

    const tokens = searchTokens(q);
    if (!tokens.length) return 0;
    const nameHits = tokens.filter(token => name.includes(token)).length;
    const packageHits = tokens.filter(token => pkg.includes(token)).length;
    const descriptionHits = tokens.filter(token => description.includes(token)).length;
    if (nameHits === tokens.length) return 5000 + nameHits * 100;
    if (packageHits === tokens.length) return 4600 + packageHits * 100;
    if (nameHits + packageHits === tokens.length) return 4000 + (nameHits + packageHits) * 100;
    if (nameHits || packageHits) return 2500 + nameHits * 200 + packageHits * 150;
    if (descriptionHits === tokens.length) return 1200;
    return 0;
}

function cleanSearchResults(items, query) {
    const unique = deduplicateApps(items);
    const ranked = unique.map((app, index) => ({ app, index, score: relevanceScore(app, query) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const relevant = ranked.filter(item => item.score > 0);
    const selected = relevant.length ? relevant : ranked;
    return selected.slice(0, MAX_VISIBLE_PER_PAGE).map(item => item.app);
}

function visibleCardCount() {
    return dom.results.querySelectorAll(".app-card").length;
}

async function searchExactPackage(packageName) {
    state.loading = true;
    setStatus("Проверяем package name…", "loading");
    try {
        const response = await api.info(packageName, state.searchController.signal);
        const exact = response?.body;
        if (!exact || normalizeSearch(exact.packageName) !== normalizeSearch(packageName)) {
            emptyState("Package не найден", `В RuStore нет точного совпадения для ${packageName}.`);
            setStatus("Точного совпадения нет");
            return;
        }
        const app = mergeApp(exact, exact);
        detailsCache.set(app.packageName, app);
        dom.results.innerHTML = cardMarkup(app);
        state.totalPages = 1;
        state.page = 1;
        dom.loadMore.hidden = true;
        setStatus("Точное совпадение", "ok");
    } catch (error) {
        if (error?.name === "AbortError") return;
        const message = String(error?.message || error);
        if (/HTTP 404|not found|не найден/i.test(message)) {
            emptyState("Package не найден", `В RuStore нет точного совпадения для ${packageName}.`);
            setStatus("Точного совпадения нет");
            return;
        }
        console.error(error);
        showError("Не удалось проверить package name", `${message}. Попробуйте ещё раз.`);
        setStatus("API недоступен", "error");
    } finally {
        state.loading = false;
    }
}

export async function searchApps(query, append = false) {
    const trimmed = query.trim();
    if (!trimmed || (append && state.loading)) return;

    if (!append) {
        state.searchController?.abort();
        state.searchController = new AbortController();
        state.query = trimmed;
        state.page = 0;
        state.totalPages = 0;
        state.loading = false;
        dom.loadMore.hidden = true;
        loadingState(PACKAGE_RE.test(trimmed) ? "Проверяем точный package name…" : "Ищем наиболее релевантные приложения…");
        if (PACKAGE_RE.test(trimmed)) {
            await searchExactPackage(trimmed);
            return;
        }
    }

    state.loading = true;
    setStatus("Соединение с RuStore…", "loading");
    try {
        const signal = state.searchController.signal;
        const searchResponse = await api.search(trimmed, state.page, SEARCH_PAGE_SIZE, signal);
        if (trimmed !== state.query) return;
        const content = Array.isArray(searchResponse?.body?.content) ? searchResponse.body.content : [];
        let apps = cleanSearchResults(content, trimmed);

        if (append) {
            const existing = new Set([...dom.results.querySelectorAll(".app-card")].map(node => node.dataset.package));
            apps = apps.filter(app => !existing.has(app.packageName));
        } else {
            dom.results.innerHTML = "";
        }

        if (!apps.length && !append) {
            emptyState("Ничего релевантного не найдено", "Попробуйте более точное название или полный package name приложения.");
            setStatus("Результатов нет");
            return;
        }

        if (apps.length) dom.results.insertAdjacentHTML("beforeend", apps.map(cardMarkup).join(""));
        state.totalPages = Number(searchResponse?.body?.totalPages || 1);
        state.page += 1;
        dom.loadMore.hidden = state.page >= state.totalPages;
        setStatus(`Показано: ${formatNumber(visibleCardCount())}`, "ok");
    } catch (error) {
        if (error?.name !== "AbortError") {
            console.error(error);
            showError("Не удалось обратиться к RuStore", `${error.message}. Попробуйте ещё раз.`);
            setStatus("API недоступен", "error");
        }
    } finally {
        state.loading = false;
    }
}

export async function getDetails(packageName) {
    if (detailsCache.has(packageName)) return detailsCache.get(packageName);
    const details = (await api.info(packageName)).body;
    if (!details) throw new Error("RuStore не вернул карточку приложения");
    const app = mergeApp({ packageName }, details);
    detailsCache.set(packageName, app);
    return app;
}

function screenshots(app) {
    return (app.fileUrls || []).slice().sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0))
        .map(item => item.fileUrl || item.url).filter(Boolean);
}

export async function showDetails(packageName) {
    const content = $("#descriptionContent");
    content.textContent = "Загрузка…";
    showModal("descriptionModal");
    try {
        const app = await getDetails(packageName);
        $("#descriptionModal h2").textContent = app.appName || packageName;
        const images = screenshots(app);
        content.innerHTML = `<p class="full-description">${escapeHtml(app.fullDescription || app.shortDescription || "Описание отсутствует")}</p>${images.length ? `<div class="detail-screenshots">${images.map((url, index) => `<button type="button" data-preview-index="${index}" data-preview-package="${escapeHtml(packageName)}"><img src="${escapeHtml(url)}" alt="Скриншот ${index + 1}" loading="lazy"></button>`).join("")}</div>` : ""}`;
    } catch (error) { content.textContent = error.message; }
}

export async function showVersions(packageName) {
    const content = $("#versionHistory");
    content.innerHTML = '<div class="modal-loading"><span class="spinner"></span> Загрузка…</div>';
    showModal("versionModal");
    try {
        const app = await getDetails(packageName);
        const versions = (await api.versionHistory(app.appId))?.body?.content || [];
        content.innerHTML = versions.length ? versions.map(version => `<article class="version-entry"><strong>${escapeHtml(version.versionName || `Code ${version.versionCode}`)}</strong><time>${formatDate(version.appVerUpdatedAt)}</time><p>${escapeHtml(version.whatsNew || "Без описания изменений")}</p></article>`).join("") : '<p class="modal-note">История версий отсутствует.</p>';
    } catch (error) { content.innerHTML = `<p class="modal-error">${escapeHtml(error.message)}</p>`; }
}

export async function showComments(packageName, sortBy = "NEW_FIRST") {
    const content = $("#appCommentsBody");
    $("#commentsModal").dataset.package = packageName;
    content.innerHTML = '<div class="modal-loading"><span class="spinner"></span> Загрузка…</div>';
    showModal("commentsModal");
    try {
        const comments = (await api.comments(packageName, sortBy))?.body?.content || [];
        content.innerHTML = comments.length ? comments.map(comment => `<article class="comment-entry"><div><strong>${escapeHtml(comment.firstName || "Пользователь")}</strong><span>${"★".repeat(Math.max(0, Math.min(5, Number(comment.appRating) || 0)))}</span></div><time>${formatDate(comment.commentDate)}</time><p>${escapeHtml(comment.commentText || "")}</p>${comment.devResponse ? `<blockquote><strong>Ответ разработчика</strong>${escapeHtml(comment.devResponse)}</blockquote>` : ""}</article>`).join("") : '<p class="modal-note">Отзывов пока нет.</p>';
    } catch (error) { content.innerHTML = `<p class="modal-error">${escapeHtml(error.message)}</p>`; }
}

function safeFileName(value) { return String(value || "app.apk").replace(/[\\/:*?"<>|]/g, "_"); }
function downloadName(entry, index, app) {
    const explicit = entry?.fileName || entry?.name;
    if (explicit && String(explicit).toLowerCase().endsWith(".apk")) return safeFileName(explicit);
    return safeFileName(`${app.packageName}-${app.versionName || app.versionCode || "latest"}${index ? `-${index + 1}` : ""}.apk`);
}

export async function downloadApp(packageName) {
    const content = $("#downloadResults");
    content.innerHTML = '<div class="modal-loading"><span class="spinner"></span> Получаем ссылки…</div>';
    showModal("downloadModal");
    try {
        const app = await getDetails(packageName);
        let response;
        try { response = await api.downloadV2(app.appId); }
        catch (error) { console.warn("v2 недоступен, используем v1", error); response = await api.downloadV1(app.appId); }
        const urls = Array.isArray(response?.body?.downloadUrls) ? response.body.downloadUrls : [];
        const entries = urls.length ? urls : response?.body?.apkUrl ? [{ url: response.body.apkUrl }] : [];
        if (!entries.length) throw new Error("RuStore не вернул ссылку на APK");
        content.innerHTML = `<div class="download-summary"><img src="${escapeHtml(app.iconUrl || "")}" alt=""><div><strong>${escapeHtml(app.appName)}</strong><span>${escapeHtml(app.versionName || "")}</span></div></div><div class="download-list">${entries.map((entry, index) => `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(downloadName(entry, index, app))}"><span>${entries.length === 1 ? "Скачать APK" : `Скачать файл ${index + 1}`}</span><small>${escapeHtml(downloadName(entry, index, app))}</small></a>`).join("")}</div><p class="modal-note">Ссылки временные и ведут напрямую на CDN RuStore.</p>`;
    } catch (error) { content.innerHTML = `<p class="modal-error">${escapeHtml(error.message)}</p>`; }
}

export async function updateSuggestions(query) {
    state.suggestionController?.abort();
    const controller = new AbortController();
    state.suggestionController = controller;
    if (query.length < 2 || PACKAGE_RE.test(query)) { dom.suggestions.hidden = true; return; }
    try {
        const response = await api.suggest(query, controller.signal);
        if (controller.signal.aborted || dom.searchInput.value.trim() !== query || document.activeElement !== dom.searchInput) return;
        const raw = response?.body?.content || response?.body || [];
        const seen = new Set();
        const values = (Array.isArray(raw) ? raw : [])
            .map(item => typeof item === "string" ? item : item?.text || item?.suggestion || item?.query)
            .map(value => String(value || "").trim())
            .filter(value => value && !seen.has(value.toLocaleLowerCase("ru-RU")) && seen.add(value.toLocaleLowerCase("ru-RU")))
            .slice(0, 5);
        dom.suggestions.innerHTML = values.map(value => `<button type="button" data-suggestion="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
        dom.suggestions.hidden = !values.length;
    } catch (error) {
        if (error?.name !== "AbortError") dom.suggestions.hidden = true;
    }
}

export { screenshots };
