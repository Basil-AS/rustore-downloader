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
- получение APK или набора Split APK, возвращённых RuStore;
- автоматическое получение актуального `ruStoreVerCode` с рабочим резервным значением;
- кэширование ответов в `sessionStorage`, отмена устаревших запросов, повторные попытки и тайм-ауты;
- ограниченная параллельная загрузка карточек;
- интерфейс без фреймворков и тяжёлых зависимостей.

## Использование

1. Откройте **[RuStore APK Downloader](https://basil-as.github.io/rustore-downloader/)**.
2. Введите название приложения или package name.
3. Выберите приложение.
4. Нажмите **«Скачать APK»**.

## Почему нужен серверный транспорт

Внутренний API пользовательского клиента RuStore требует нестандартный заголовок `ruStoreVerCode`. Обычный браузерный запрос с GitHub Pages не может надёжно отправлять его непосредственно в `backapi.rustore.ru` из-за CORS.

Старая версия проекта использовала анонимный `corsproxy.io`. Этот вариант больше не считается рабочей схемой: для CorsProxy нужен API key, поэтому проект больше не зависит от него по умолчанию.

Текущая последовательность транспорта:

1. **Vercel same-origin `/api`** — при размещении проекта на `*.vercel.app`; файл [`vercel.json`](./vercel.json) уже содержит rewrite на RuStore API.
2. **Собственный Cloudflare Worker** — если задан `rustoreProxyUrl`.
3. **CorsProxy с собственным API key** — если задан `rustoreCorsProxyKey`.
4. **Публичный Worker только как аварийный fallback для GitHub Pages.** Для постоянного production-размещения лучше использовать первые два варианта.

APK после получения временной ссылки скачивается напрямую с CDN RuStore и не проксируется через проект.

## Рекомендуемый деплой: Vercel

В репозитории уже есть `vercel.json`:

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

При импорте репозитория в Vercel дополнительный backend писать не требуется: браузер обращается к `/api/...` на том же origin, а Vercel пересылает запрос в RuStore. Код автоматически выбирает этот транспорт на домене `*.vercel.app`.

## Собственный Cloudflare Worker

Worker находится в каталоге [`worker`](./worker):

```bash
cd worker
npx wrangler deploy
```

После деплоя укажите адрес Worker в браузере:

```js
localStorage.setItem(
  "rustoreProxyUrl",
  "https://YOUR-WORKER.workers.dev/?url={url}"
);
```

Вернуться к автоматическому выбору транспорта:

```js
localStorage.removeItem("rustoreProxyUrl");
```

Worker ограничивает target только доменом `backapi.rustore.ru` и разрешённым набором API endpoints.

## CorsProxy со своим ключом

Поддержка сохранена для пользователей CorsProxy:

```js
localStorage.setItem("rustoreCorsProxyKey", "YOUR_API_KEY");
```

Удалить настройку:

```js
localStorage.removeItem("rustoreCorsProxyKey");
```

## Локальный запуск

```bash
python -m http.server 8080
```

Откройте `http://localhost:8080`.

## Ограничения

- Используется неофициально документированный внутренний API пользовательского клиента RuStore; он может измениться без предупреждения.
- Обычно через download endpoint доступна последняя опубликованная версия приложения.
- Временные ссылки RuStore могут истечь.
- GitHub Pages является полностью статическим хостингом, поэтому стабильная работа зависит от внешнего транспорта; для постоянной эксплуатации рекомендуется Vercel rewrite или собственный Worker.
- Проект не связан с VK, RuStore или разработчиками приложений.

## Лицензия

Код распространяется по лицензии [MIT](./LICENSE). Атрибуция и сведения о происхождении приведены в файле [NOTICE](./NOTICE).

## Происхождение

Проект основан на интерфейсе [`kolya00736/rustore-downloader`](https://github.com/kolya00736/rustore-downloader). Текущая реализация существенно переработана: восстановлена работа с актуальными требованиями RuStore API, добавлены поиск по package name, несколько транспортов API, поддержка Split APK, оптимизация запросов и обновлённый интерфейс.
