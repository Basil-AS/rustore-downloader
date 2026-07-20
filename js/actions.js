import { api, PACKAGE_RE, detailsCache, state, dom, $, escapeHtml, formatDate, formatNumber, mergeApp, deduplicateApps, mapLimit } from "./common.js";
import { setStatus, emptyState, loadingState, showError, cardMarkup, updateCard, showModal } from "./render.js";

async function hydrateApps(items, signal) {
    await mapLimit(items, 5, async summary => {
        if (!summary.packageName || detailsCache.has(summary.packageName)) return;
        try {
            const details = (await api.info(summary.packageName, signal)).body;
            if (!details) return;
            const app = mergeApp(summary, details);
            detailsCache.set(summary.packageName, app);
            updateCard(summary.packageName, app);
        } catch (error) {
            if (error?.name !== "AbortError") console.debug("Не удалось загрузить подробности", summary.packageName, error);
        }
    });
}

export async function searchApps(query, append = false) {
    const trimmed = query.trim();
    if (!trimmed || (append && state.loading)) return;
    if (!append) {
        state.searchController?.abort();
        state.searchController = new AbortController();
        state.query = trimmed;
        state.page = 0;
        state.loading = false;
        loadingState(PACKAGE_RE.test(trimmed) ? "Проверяем package name…" : "Ищем по каталогу RuStore…");
        dom.loadMore.hidden = true;
    }
    state.loading = true;
    setStatus("Соединение с RuStore…", "loading");
    try {
        const signal = state.searchController.signal;
        const requests = [api.search(trimmed, state.page, 18, signal)];
        if (!append && PACKAGE_RE.test(trimmed)) requests.push(api.info(trimmed, signal));
        const settled = await Promise.allSettled(requests);
        if (trimmed !== state.query) return;
        const searchResponse = settled[0].status === "fulfilled" ? settled[0].value : null;
        const content = searchResponse?.body?.content || [];
        const exactInfo = settled[1]?.status === "fulfilled" ? settled[1].value?.body : null;
        const apps = deduplicateApps(exactInfo ? [exactInfo, ...content] : content);
        if (!append) dom.results.innerHTML = "";
        if (!apps.length && !append) {
            emptyState("Ничего не найдено", "Попробуйте другое название или полный package name приложения.");
            setStatus("Результатов нет");
            return;
        }
        dom.results.insertAdjacentHTML("beforeend", apps.map(cardMarkup).join(""));
        if (exactInfo) detailsCache.set(exactInfo.packageName, mergeApp(exactInfo, exactInfo));
        state.totalPages = Number(searchResponse?.body?.totalPages || 1);
        state.page += 1;
        dom.loadMore.hidden = state.page >= state.totalPages;
        setStatus(`Найдено: ${formatNumber(searchResponse?.body?.totalElements || apps.length)}`, "ok");
        hydrateApps(apps, signal);
    } catch (error) {
        if (error?.name !== "AbortError") {
            console.error(error);
            showError("Не удалось обратиться к RuStore", `${error.message}. Попробуйте ещё раз или подключите собственный Worker.`);
            setStatus("API недоступен", "error");
        }
    } finally { state.loading = false; }
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
    state.suggestionController = new AbortController();
    if (query.length < 2 || PACKAGE_RE.test(query)) { dom.suggestions.hidden = true; return; }
    try {
        const response = await api.suggest(query, state.suggestionController.signal);
        const raw = response?.body?.content || response?.body || [];
        const values = (Array.isArray(raw) ? raw : []).map(item => typeof item === "string" ? item : item?.text || item?.suggestion || item?.query).filter(Boolean).slice(0, 6);
        dom.suggestions.innerHTML = values.map(value => `<button type="button" data-suggestion="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
        dom.suggestions.hidden = !values.length;
    } catch { dom.suggestions.hidden = true; }
}

export { screenshots };
