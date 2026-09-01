<div align="center">

# RuStore APK Downloader

**Поиск приложений RuStore по названию или package name и получение прямых оригинальных ссылок на APK.**

[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://dash.cloudflare.com/)
[![Vanilla JavaScript](https://img.shields.io/badge/Vanilla_JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111)](https://github.com/Basil-AS/rustore-downloader)
[![MIT License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)
[![Verify web app](https://github.com/Basil-AS/rustore-downloader/actions/workflows/verify.yml/badge.svg)](https://github.com/Basil-AS/rustore-downloader/actions/workflows/verify.yml)

</div>

## Возможности

- поиск по названию приложения и package name;
- автодополнение через публичный веб-API RuStore;
- карточка приложения, версия, размер, Android SDK, описание, скриншоты, история версий и отзывы;
- получение APK или Split APK через актуальный `v2/download-link` с fallback на v1;
- актуальный `ruStoreVerCode`, резервное значение `110802`;
- кэширование, отмена устаревших запросов, retry и timeout;
- Cloudflare Pages Function `/api/*` без отдельного сервера;
- альтернативные транспорты: Vercel, собственный Cloudflare Worker и CorsProxy с API key.

## Почему чистого GitHub Pages недостаточно

RuStore требует нестандартный заголовок `ruStoreVerCode` для запросов к `backapi.rustore.ru`. Браузер с полностью статического GitHub Pages упирается в CORS, поэтому полный поиск карточек и получение APK требуют server-side/edge транспорта.

Ранее проект использовал анонимный `corsproxy.io`, но этот вариант больше не является рабочей схемой без API key. Проверенный публичный demo Worker также нельзя использовать как production-прокси.

## Рекомендуемый вариант — Cloudflare Pages

В репозитории уже находится Pages Function [`functions/api/[[path]].js`](./functions/api/[[path]].js). Она принимает только разрешённые RuStore API endpoints и проксирует их на `backapi.rustore.ru`.

После размещения на домене `*.pages.dev` frontend автоматически переключается на same-origin `/api`, поэтому CORS больше не нужен.

### Деплой из GitHub

1. Откройте Cloudflare Dashboard → **Workers & Pages**.
2. Нажмите **Create application** → **Pages** → **Import an existing Git repository**.
3. Подключите GitHub и выберите `Basil-AS/rustore-downloader`.
4. Укажите:

```text
Production branch: main
Build command: exit 0
Build output directory: .
```

5. Нажмите **Save and Deploy**.

Cloudflare выдаст адрес вида:

```text
https://rustore-downloader.pages.dev
```

Имя может отличаться, если такой Pages project name уже занят.

После этого каждый push в `main` автоматически создаёт новый production deployment, а остальные ветки могут получать preview deployments.

### Как работает Cloudflare-вариант

```text
Browser
   ↓
https://PROJECT.pages.dev/api/applicationData/...
   ↓
Cloudflare Pages Function
   ↓  ruStoreVerCode
https://backapi.rustore.ru/applicationData/...
   ↓
JSON с временной ссылкой RuStore
   ↓
APK скачивается напрямую с CDN RuStore
```

Сам APK через Cloudflare Function не проксируется.

## Альтернатива — Vercel

Файл [`vercel.json`](./vercel.json) оставлен как дополнительный вариант. На `*.vercel.app` приложение также автоматически использует same-origin `/api`.

## Отдельный Cloudflare Worker

Для использования GitHub Pages как frontend можно развернуть готовый ограниченный proxy из [`worker/worker.js`](./worker/worker.js):

```bash
cd worker
npx wrangler deploy
```

После деплоя укажите URL Worker в браузере:

```js
localStorage.setItem(
  "rustoreProxyUrl",
  "https://YOUR-WORKER.workers.dev/?url={url}"
);
location.reload();
```

Сбросить настройку:

```js
localStorage.removeItem("rustoreProxyUrl");
location.reload();
```

## CorsProxy с собственным API key

Поддерживается как дополнительный вариант:

```js
localStorage.setItem("rustoreCorsProxyKey", "YOUR_API_KEY");
location.reload();
```

Сброс:

```js
localStorage.removeItem("rustoreCorsProxyKey");
location.reload();
```

## GitHub Pages

`https://basil-as.github.io/rustore-downloader/` остаётся статическим frontend/demo. Без настроенного Worker или CorsProxy key он явно покажет, что API-транспорт отсутствует.

Для полностью рабочего публичного экземпляра используйте Cloudflare Pages.

## Локальный запуск

Для проверки только интерфейса:

```bash
python -m http.server 8080
```

Для локальной проверки Pages Function используйте Wrangler/Cloudflare Pages development environment либо задайте отдельный `rustoreProxyUrl`.

## Ограничения

- используется внутренний, официально не документированный API пользовательского клиента RuStore;
- RuStore может менять endpoints, обязательные заголовки и payload без предупреждения;
- обычно download endpoint выдаёт последнюю опубликованную версию;
- временные CDN-ссылки могут истечь;
- проект не связан с VK или RuStore.

## Лицензия

Код распространяется по [MIT License](./LICENSE). Сведения о происхождении и атрибуция находятся в [NOTICE](./NOTICE).

## Происхождение

Проект основан на интерфейсе [`kolya00736/rustore-downloader`](https://github.com/kolya00736/rustore-downloader). Текущая реализация существенно переработана: обновлён RuStore API transport, добавлены поиск по package name, Split APK, Cloudflare Pages/Worker transport, Vercel fallback, оптимизация запросов и новый интерфейс.
