<div align="center">

# RuStore APK Downloader

**Поиск приложений RuStore по названию или package name и получение прямых оригинальных ссылок на APK.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBasil-AS%2Frustore-downloader)

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
- несколько вариантов транспорта к RuStore API.

## Почему чистого GitHub Pages недостаточно

RuStore требует нестандартный заголовок `ruStoreVerCode` для запросов к `backapi.rustore.ru`. Браузер с полностью статического GitHub Pages упирается в CORS, поэтому **полный поиск карточек и получение APK требуют server-side/edge транспорта**.

Ранее проект использовал анонимный `corsproxy.io`, но этот вариант больше не является рабочей схемой без API key. Проверенный публичный demo Worker также нельзя использовать как production-прокси. Поэтому в проекте больше нет ложного публичного fallback.

## Рекомендуемый вариант — Vercel

Нажмите кнопку **Deploy with Vercel** вверху README и импортируйте репозиторий. Никакой отдельный backend писать не требуется.

Файл [`vercel.json`](./vercel.json) уже содержит rewrite:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://backapi.rustore.ru/:path*"
    }
  ]
}
```

На `*.vercel.app` приложение автоматически выбирает same-origin `/api`, поэтому браузер больше не сталкивается с CORS RuStore.

## Собственный Cloudflare Worker

Готовый ограниченный proxy находится в [`worker/worker.js`](./worker/worker.js):

```bash
cd worker
npx wrangler deploy
```

После деплоя укажите URL в браузере:

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

Worker принимает только разрешённые RuStore endpoints и сам добавляет `ruStoreVerCode`.

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

Страница `https://basil-as.github.io/rustore-downloader/` остаётся статическим frontend/demo. Без настроенного Worker или CorsProxy key она явно покажет, что API-транспорт отсутствует, вместо зависания или неинформативной ошибки.

## Локальный запуск

```bash
python -m http.server 8080
```

Для полного функционала локально также задайте `rustoreProxyUrl` либо используйте локальный reverse proxy.

## Ограничения

- используется внутренний, официально не документированный API пользовательского клиента RuStore;
- RuStore может менять endpoints, обязательные заголовки и payload без предупреждения;
- обычно download endpoint выдаёт последнюю опубликованную версию;
- временные CDN-ссылки могут истечь;
- проект не связан с VK или RuStore.

## Лицензия

Код распространяется по [MIT License](./LICENSE). Сведения о происхождении и атрибуция находятся в [NOTICE](./NOTICE).

## Происхождение

Проект основан на интерфейсе [`kolya00736/rustore-downloader`](https://github.com/kolya00736/rustore-downloader). Текущая реализация существенно переработана: обновлён RuStore API transport, добавлены поиск по package name, Split APK, Vercel/Worker transport, оптимизация запросов и новый интерфейс.
