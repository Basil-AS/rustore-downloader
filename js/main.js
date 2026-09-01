import { $, dom, state, PACKAGE_RE } from "./common.js";
import { setStatus, emptyState, hideModal, openPreview, updatePreview } from "./render.js";
import { searchApps, getDetails, showDetails, showVersions, showComments, downloadApp, updateSuggestions, screenshots } from "./actions.js";

let searchTimer;
let suggestionTimer;

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
    clearTimeout(suggestionTimer);
    if (abort) {
        state.suggestionController?.abort();
        state.suggestionController = null;
    }
    dom.suggestions.hidden = true;
}

function scheduleSuggestions(query, delay = 180) {
    clearTimeout(suggestionTimer);
    if (query.length < 2 || PACKAGE_RE.test(query)) {
        closeSuggestions();
        return;
    }
    suggestionTimer = setTimeout(() => {
        if (dom.searchInput.value.trim() !== query || document.activeElement !== dom.searchInput) return;
        updateSuggestions(query);
    }, delay);
}

function scheduleSearch(query, delay = 550) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        if (dom.searchInput.value.trim() === query) searchApps(query);
    }, delay);
}

dom.searchInput.addEventListener("input", () => {
    const query = dom.searchInput.value.trim();
    dom.clearSearch.classList.toggle("hidden", !query);
    clearTimeout(searchTimer);
    clearTimeout(suggestionTimer);
    state.searchController?.abort();

    if (!query) {
        state.query = "";
        closeSuggestions();
        if (transportReady()) {
            emptyState("Введите название приложения", "Можно искать по названию или идентификатору пакета Android.");
        } else {
            emptyState("Нужен серверный транспорт", "GitHub Pages использует подключённый Cloudflare Worker для доступа к RuStore API.");
        }
        resetStatus();
        return;
    }

    scheduleSuggestions(query);
    scheduleSearch(query, PACKAGE_RE.test(query) ? 350 : 550);
});

dom.searchInput.addEventListener("focus", () => {
    const query = dom.searchInput.value.trim();
    if (query.length >= 2 && !PACKAGE_RE.test(query)) scheduleSuggestions(query, 80);
});

dom.searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(searchTimer);
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
    dom.clearSearch.classList.remove("hidden");
    clearTimeout(searchTimer);
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
    emptyState("Нужен серверный транспорт", "Для GitHub Pages должен быть доступен подключённый Cloudflare Worker.");
}
