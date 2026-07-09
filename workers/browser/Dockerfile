# Браузерный воркер: базовый образ Playwright уже содержит Chromium + системные зависимости.
# Версия тега ДОЛЖНА совпадать с версией playwright в package.json (1.48.0), иначе браузер не найдётся.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Xvfb — виртуальный X11-дисплей для headful-Chromium на сервере без монитора.
# Ставим ЯВНО: прошлый деплой упал в 502, т.к. `xvfb-run` в образе не оказалось.
# Гарантируем, что бинарь Xvfb на месте (start.sh поднимает его напрямую, без xvfb-run).
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*

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
# start.sh поднимает Xvfb напрямую и делает exec node (см. файл). Под guard'ом:
# если Xvfb не стартует — node всё равно запускается (getBrowser деградирует в headless),
# воркер НЕ падает. Railway startCommand в railway.json тоже указывает на start.sh.
CMD ["sh", "start.sh"]
