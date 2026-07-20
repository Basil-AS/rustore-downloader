<div align="center">

# RuStore APK Downloader

**Поиск приложений RuStore по названию или package name и получение прямых оригинальных ссылок на APK.**

[![Open Web App](https://img.shields.io/badge/Open_Web_App-5B4FD8?style=for-the-badge&logo=githubpages&logoColor=white)](https://basil-as.github.io/rustore-downloader/)
[![Vanilla JavaScript](https://img.shields.io/badge/Vanilla_JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111)](https://github.com/Basil-AS/rustore-downloader)
[![MIT License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)
[![Verify web app](https://github.com/Basil-AS/rustore-downloader/actions/workflows/verify.yml/badge.svg)](https://github.com/Basil-AS/rustore-downloader/actions/workflows/verify.yml)

### [Открыть веб-приложение →](https://basil-as.github.io/rustore-downloader/)

</div>

## Возможности

- поиск по обычному названию приложения;
- точный поиск по package name, например `com.vkontakte.android`;
- автодополнение поискового запроса;
- просмотр версии, размера, минимальной версии Android, описания, скриншотов, истории версий и отзывов;
- получение одного универсального APK или набора ссылок, возвращённых RuStore;
- автоматическое получение актуального `ruStoreVerCode`;
- кэширование ответов в `sessionStorage`, отмена устаревших запросов, повторные попытки и тайм-ауты;
- ограниченная параллельная загрузка карточек вместо последовательных запросов;
- интерфейс без фреймворков и тяжёлых зависимостей.

## Использование

1. Откройте **[RuStore APK Downloader](https://basil-as.github.io/rustore-downloader/)**.
2. Введите название приложения или package name.
3. Выберите приложение.
4. Нажмите **«Скачать APK»**.

## Почему используется прокси

Внутренний API пользовательского клиента RuStore требует заголовок `ruStoreVerCode`. Браузерный запрос с нестандартным заголовком вызывает CORS preflight, который сервер RuStore может не разрешить. Поэтому веб-версия направляет API-запросы через CORS-прокси, который добавляет заголовок на серверной стороне. APK после получения ссылки скачивается напрямую с CDN RuStore.

По умолчанию используется публичный `corsproxy.io`. Для стабильной собственной инсталляции рекомендуется развернуть небольшой Cloudflare Worker из каталога [`worker`](./worker) и указать его URL:

```js
localStorage.setItem(
  "rustoreProxyUrl",
  "https://YOUR-WORKER.workers.dev/?url={url}"
);
```

Чтобы вернуться к публичному прокси:

```js
localStorage.removeItem("rustoreProxyUrl");
```

## Собственный Cloudflare Worker

```bash
cd worker
npx wrangler deploy
```

В `wrangler.toml` задайте разрешённый origin GitHub Pages. Worker принимает только запросы к `backapi.rustore.ru` и ограниченному списку RuStore API endpoints.

## Локальный запуск

```bash
python -m http.server 8080
```

Откройте `http://localhost:8080`.

## Ограничения

- Используется неофициально документированный внутренний API пользовательского клиента RuStore; он может измениться.
- Обычно доступна последняя опубликованная версия приложения.
- Временные ссылки RuStore могут истечь.
- Доступность публичного CORS-прокси не контролируется этим проектом; для постоянной эксплуатации используйте собственный Worker.
- Проект не связан с VK, RuStore или разработчиками приложений.

## Лицензия

Код распространяется по лицензии [MIT](./LICENSE). Атрибуция и сведения о происхождении приведены в файле [NOTICE](./NOTICE).

## Происхождение

Проект основан на интерфейсе [`kolya00736/rustore-downloader`](https://github.com/kolya00736/rustore-downloader). Текущая реализация существенно переработана: восстановлена работа с актуальными требованиями RuStore API, добавлены поиск по package name, CORS-прокси, оптимизация запросов и обновлённый интерфейс.
