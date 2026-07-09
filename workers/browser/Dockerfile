# Браузерный воркер: базовый образ Playwright уже содержит Chromium + системные зависимости.
# Версия тега ДОЛЖНА совпадать с версией playwright в package.json (1.48.0), иначе браузер не найдётся.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Только манифесты сначала — кэш слоёв npm.
COPY package.json ./
# Браузеры уже в образе — не докачиваем (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
# PORT выставляет Railway. Локально по умолчанию 8090.
EXPOSE 8090
# Запуск ПОД ВИРТУАЛЬНЫМ ДИСПЛЕЕМ Xvfb: браузер работает headful (видимое окно),
# но на сервере без монитора. Именно headful пускает Instagram — headless он отдаёт
# бот-стену (см. lib/browser.js getBrowser, plan.md §1). xvfb-run уже в образе Playwright.
# `-a` — сам подберёт свободный номер дисплея; экран 1280x1024x24 под наш viewport.
# Если Xvfb недоступен — getBrowser деградирует в headless (не падает).
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "node", "server.js"]
