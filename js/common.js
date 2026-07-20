export const api = window.RuStoreApi;
export const PACKAGE_RE = /^[a-zA-Z][\w]*(?:\.[\w]+)+$/;
export const detailsCache = new Map();
export const state = {
    query: "", page: 0, totalPages: 0, loading: false,
    searchController: null, suggestionController: null,
    imageIndex: 0, images: []
};

const sdkVersions = {
    21: "5.0", 22: "5.1", 23: "6.0", 24: "7.0", 25: "7.1", 26: "8.0",
    27: "8.1", 28: "9", 29: "10", 30: "11", 31: "12", 32: "12L",
    33: "13", 34: "14", 35: "15", 36: "16"
};

export const $ = selector => document.querySelector(selector);
export const dom = {
    searchInput: $("#searchInput"), clearSearch: $("#clearSearch"), results: $("#searchResults"),
    loadMore: $("#loadMore"), suggestions: $("#searchSuggestions"), apiStatus: $("#apiStatus")
};

export function escapeHtml(value = "") {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "—";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ru-RU");
}

export function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("ru-RU") : "0";
}

export function androidVersion(sdk) {
    const number = Number(sdk);
    return sdkVersions[number] ? `Android ${sdkVersions[number]}` : number ? `API ${number}` : "—";
}

export function appSummary(item) {
    return {
        appId: item?.appId, packageName: item?.packageName || "",
        appName: item?.appName || item?.name || item?.packageName || "Приложение",
        iconUrl: item?.iconUrl || item?.icon || "", shortDescription: item?.shortDescription || "",
        versionName: item?.versionName || "", versionCode: item?.versionCode, fileSize: item?.fileSize,
        minSdkVersion: item?.minSdkVersion, downloads: item?.downloads,
        averageUserRating: item?.averageUserRating ?? item?.rating?.average ?? 0,
        totalRatings: item?.totalRatings ?? item?.rating?.votes ?? 0,
        appVerUpdatedAt: item?.appVerUpdatedAt || item?.updatedAt,
        fileUrls: Array.isArray(item?.fileUrls) ? item.fileUrls : []
    };
}

export const mergeApp = (summary, details) => ({ ...appSummary(summary), ...appSummary(details), ...details });

export function deduplicateApps(items) {
    const map = new Map();
    items.forEach(item => {
        const app = appSummary(item);
        if (app.packageName && !map.has(app.packageName)) map.set(app.packageName, app);
    });
    return [...map.values()];
}

export async function mapLimit(items, limit, worker) {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) await worker(queue.shift());
    });
    await Promise.allSettled(runners);
}
