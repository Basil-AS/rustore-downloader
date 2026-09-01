import { $, dom, state, escapeHtml, formatFileSize, formatDate, formatNumber, androidVersion } from "./common.js";

export function setStatus(text, kind = "neutral") {
    dom.apiStatus.textContent = text;
    dom.apiStatus.dataset.kind = kind;
}

export function emptyState(title, text) {
    dom.results.innerHTML = `<div class="empty-state"><div class="empty-state-icon">APK</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

export function loadingState(text = "Ищем приложения…") {
    dom.results.innerHTML = `<div class="loading-state"><span class="spinner" aria-hidden="true"></span><strong>${escapeHtml(text)}</strong></div>`;
}

export function showError(title, message) {
    dom.results.innerHTML = `<div class="error-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p><button type="button" data-action="retry-search">Повторить</button></div>`;
}

function renderStars(rating) {
    const safe = Math.max(0, Math.min(5, Number(rating) || 0));
    const rounded = Math.round(safe);
    return `<span class="stars" aria-label="Рейтинг ${safe.toFixed(1)} из 5">${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}</span>`;
}

export function cardMarkup(app) {
    const packageName = escapeHtml(app.packageName);
    const icon = app.iconUrl
        ? `<img class="app-icon" src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy" decoding="async">`
        : `<div class="app-icon app-icon-placeholder">APK</div>`;
    return `<article class="app-card" data-package="${packageName}">
        <div class="app-card-head">${icon}<div class="app-title-wrap">
            <h3>${escapeHtml(app.appName)}</h3>
            <button class="package-copy" type="button" data-action="copy-package" title="Скопировать package name">${packageName}</button>
            <div class="rating-row">${renderStars(app.averageUserRating)}<span>${Number(app.averageUserRating || 0).toFixed(1)}</span><small>${formatNumber(app.totalRatings)} оценок</small></div>
        </div></div>
        <p class="app-description">${escapeHtml(app.shortDescription || "Описание загружается…")}</p>
        <dl class="app-meta">
            <div><dt>Версия</dt><dd data-field="version">${escapeHtml(app.versionName || "—")}</dd></div>
            <div><dt>Размер</dt><dd data-field="size">${formatFileSize(app.fileSize)}</dd></div>
            <div><dt>Android</dt><dd data-field="android">${androidVersion(app.minSdkVersion)}</dd></div>
            <div><dt>Обновлено</dt><dd data-field="updated">${formatDate(app.appVerUpdatedAt)}</dd></div>
        </dl>
        <div class="app-actions">
            <button class="download-btn" type="button" data-action="download">Скачать APK</button>
            <button class="text-action" type="button" data-action="details">Описание</button>
            <button class="text-action" type="button" data-action="versions">Версии</button>
            <button class="text-action" type="button" data-action="comments">Отзывы</button>
            <a class="text-action" href="https://www.rustore.ru/catalog/app/${encodeURIComponent(app.packageName)}" target="_blank" rel="noopener noreferrer">RuStore ↗</a>
        </div>
    </article>`;
}

export function updateCard(packageName, app) {
    const card = [...document.querySelectorAll(".app-card")].find(node => node.dataset.package === packageName);
    if (!card) return;
    card.querySelector("h3").textContent = app.appName || packageName;
    card.querySelector(".app-description").textContent = app.shortDescription || "Описание отсутствует";
    card.querySelector('[data-field="version"]').textContent = app.versionName || "—";
    card.querySelector('[data-field="size"]').textContent = formatFileSize(app.fileSize);
    card.querySelector('[data-field="android"]').textContent = androidVersion(app.minSdkVersion);
    card.querySelector('[data-field="updated"]').textContent = formatDate(app.appVerUpdatedAt || app.updatedAt);
}

export function showModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove("hidden");
    modal.classList.add("show");
    document.body.classList.add("modal-open");
}

export function hideModal(modal) {
    modal.classList.add("hidden");
    modal.classList.remove("show");
    if (!document.querySelector(".modal.show")) document.body.classList.remove("modal-open");
}

export function openPreview(urls, index = 0) {
    state.images = urls;
    state.imageIndex = index;
    updatePreview();
    showModal("imagePreviewModal");
}

export function updatePreview() {
    $("#previewImage").src = state.images[state.imageIndex] || "";
    $("#imageProgress").textContent = state.images.length ? `${state.imageIndex + 1} / ${state.images.length}` : "";
    $("#prevImage").hidden = state.imageIndex <= 0;
    $("#nextImage").hidden = state.imageIndex >= state.images.length - 1;
}
