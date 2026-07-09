#!/bin/sh
# Старт браузерного воркера. Поднимаем виртуальный X11-дисплей (Xvfb) для headful-Chromium:
# Instagram отдаёт HEADLESS-браузеру бот-стену без формы входа, а живому окну — нормальный
# вход (см. lib/browser.js getBrowser, plan.md §1, memory browser-worker-must-be-headful).
#
# ВАЖНО: всё под guard'ом. Если Xvfb нет или он не поднялся — просто стартуем node
# (getBrowser сам деградирует в headless). Воркер НИКОГДА не должен падать в 502
# из-за дисплея — это ровно тот баг, что уронил прошлый деплой (xvfb-run отсутствовал).
# Поэтому НЕ используем `set -e` до exec, а Xvfb запускаем в фоне (его сбой не валит скрипт).

if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  export DISPLAY=:99
  sleep 1
  echo "[start] Xvfb запущен, DISPLAY=$DISPLAY"
else
  echo "[start] Xvfb НЕ найден — стартуем в headless (getBrowser деградирует сам)"
fi

# exec — node становится основным процессом и получает сигналы Railway (SIGTERM при редеплое).
exec node server.js
