import { NextResponse } from 'next/server'

/**
 * Диагностика: проверить, ЖИВ ли Python-воркер и КАКАЯ сборка/версия instagrapi реально
 * задеплоена. Открой <app-url>/api/worker-health в браузере (будучи залогиненным).
 *  - build: "2026-07-07-diag" → новый код воркера применился.
 *  - 404 / нет build → воркер работает на СТАРОМ образе (деплой Python-сервиса не проходит).
 *  - error/timeout → воркер недоступен (упал или не тот URL).
 */
const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL ?? 'http://localhost:8001'

export async function GET() {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(`${PYTHON_WORKER_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
    const body = await r.text()
    let worker: any = null
    try { worker = body ? JSON.parse(body) : null } catch { worker = body.slice(0, 300) }
    return NextResponse.json({
      reachable: true,
      httpStatus: r.status,
      hasPickProxy: r.ok && !!worker && typeof worker === 'object' && 'build' in worker,
      worker,
      ms: Date.now() - started,
    })
  } catch (e: any) {
    return NextResponse.json({
      reachable: false,
      error: e?.name === 'AbortError' ? 'timeout 15s — воркер не ответил' : (e?.message ?? 'no answer'),
      hint: 'Воркер недоступен: упал, не задеплоен, или PYTHON_WORKER_URL неверный.',
      ms: Date.now() - started,
    })
  } finally {
    clearTimeout(timer)
  }
}
