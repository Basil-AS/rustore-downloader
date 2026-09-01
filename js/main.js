import { $, dom, state } from "./common.js";
import { setStatus, emptyState, hideModal, openPreview, updatePreview } from "./render.js";
import { searchApps, getDetails, showDetails, showVersions, showComments, downloadApp, updateSuggestions, screenshots } from "./actions.js";

let debounceTimer;

function transportReady() {
    return Boolean(window.RuStoreApi?.isConfigured?.());
}

function transportLabel(mode) {
    return ({
        "cloudflare-workers": "Cloudflare Workers",
        "cloudflare-pages": "Cloudflare Pages",
        "github-pages-via-cloudflare": "GitHub Pages + Cloudflare",
        "vercel": "Vercel",
        "same-origin": "Same-origin API",
        "custom-worker": "Cloudflare Worker",
        "corsproxy-key": "CorsProxy"
    })[mode] || mode || "API";
}

function resetStatus() {
    if (transportReady()) {
        const mode = window.RuStoreApi.getTransportMode?.();
        setStatus(`API подключён: ${transportLabel(mode)}`, "ok");
    } else {
        setStatus("Нужен API-прокси", "error");
    }
}

function closeSuggestions({ abort = true } = {}) {
    if (abort) {
        state.suggestionController?.abort();
        state.suggestionController = null;
    }
    dom.suggestions.hidden = true;
}

dom.searchInput.addEventListener("input", () => {
    const query = dom.searchInput.value.trim();
    dom.clearSearch.classList.toggle("hidden", !query);
    clearTimeout(debounceTimer);
    if (!query) {
        state.searchController?.abort();
        state.query = "";
        closeSuggestions();
        if (transportReady()) {
            emptyState("Введите название приложения", "Можно искать по названию или идентификатору пакета Android.");
        } else {
            emptyState("Нужен серверный транспорт", "На Cloudflare Pages API работает автоматически. На чистом GitHub Pages нужен собственный Worker или другой серверный транспорт.");
        }
        resetStatus();
        return;
    }
    updateSuggestions(query);
    debounceTimer = setTimeout(() => searchApps(query), 330);
});

dom.searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        clearTimeout(debounceTimer);
        closeSuggestions();
        searchApps(dom.searchInput.value);
    } else if (event.key === "Escape") {
        closeSuggestions();
        dom.searchInput.blur();
    }
});

dom.clearSearch.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.searchInput.dispatchEvent(new Event("input"));
    dom.searchInput.focus();
});

dom.suggestions.addEventListener("click", event => {
    const button = event.target.closest("[data-suggestion]");
    if (!button) return;
    dom.searchInput.value = button.dataset.suggestion;
    closeSuggestions();
    searchApps(dom.searchInput.value);
});

document.addEventListener("click", async event => {
    if (!event.target.closest(".search-control")) closeSuggestions();

    const example = event.target.closest("[data-example]");
    if (example) {
        dom.searchInput.value = example.dataset.example;
        dom.searchInput.dispatchEvent(new Event("input"));
        dom.searchInput.focus();
        return;
    }
    const preview = event.target.closest("[data-preview-index]");
    if (preview) {
        const app = await getDetails(preview.dataset.previewPackage);
        openPreview(screenshots(app), Number(preview.dataset.previewIndex || 0));
        return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const packageName = action.closest(".app-card")?.dataset.package;
    switch (action.dataset.action) {
        case "retry-search": searchApps(state.query); break;
        case "copy-package":
            try {
                await navigator.clipboard.writeText(packageName);
                action.textContent = "Скопировано";
                setTimeout(() => { action.textContent = packageName; }, 900);
            } catch { window.prompt("Скопируйте package name:", packageName); }
            break;
        case "download": downloadApp(packageName); break;
        case "details": showDetails(packageName); break;
        case "versions": showVersions(packageName); break;
        case "comments": showComments(packageName); break;
    }
});

dom.loadMore.addEventListener("click", () => searchApps(state.query, true));
document.querySelectorAll(".modal-close").forEach(button => button.addEventListener("click", () => hideModal(button.closest(".modal"))));
document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) hideModal(modal); }));
$("#prevImage").addEventListener("click", () => { state.imageIndex = Math.max(0, state.imageIndex - 1); updatePreview(); });
$("#nextImage").addEventListener("click", () => { state.imageIndex = Math.min(state.images.length - 1, state.imageIndex + 1); updatePreview(); });
document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeSuggestions();
        document.querySelectorAll(".modal.show").forEach(hideModal);
    }
});
$("#commentsFilterOption").addEventListener("change", event => {
    const packageName = $("#commentsModal").dataset.package;
    if (packageName) showComments(packageName, event.target.value);
});

resetStatus();
if (!transportReady()) {
    emptyState("Нужен серверный транспорт", "Рекомендуемый вариант — импортировать этот репозиторий в Cloudflare Pages: встроенная Pages Function /api заработает автоматически.");
}
