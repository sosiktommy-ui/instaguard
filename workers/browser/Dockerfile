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
CMD ["node", "server.js"]
