FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8001
EXPOSE 8001
# ОДИН процесс намеренно: challenge-логин держит состояние в памяти (_challenge_sessions),
# несколько воркеров разнесли бы /login и /login-challenge по разным процессам и сломали флоу.
# --limit-concurrency защищает от перегрузки (лишние запросы → 503, а не OOM/зависание).
CMD ["sh", "-c", "uvicorn worker:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 65 --limit-concurrency 24"]
