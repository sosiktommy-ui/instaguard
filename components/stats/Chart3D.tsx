'use client'

import { useEffect, useRef } from 'react'

export interface Chart3DData {
  /** [Новая подписка, Комментарий, Лайк, Ответ на сторис] — срабатывания по типу кампании */
  campaigns: number[]
  /** [Директ, Лайк, Подписка, Сторис, Коммент] — выполненные действия */
  actions: number[]
  /** топ аккаунтов по срабатываниям */
  accounts: { label: string; value: number }[]
}

/**
 * Встраивает 3D-диаграмму статистики (public/stats3d/index.html, Three.js/WebGPU
 * с авто-фолбэком на WebGL2) в iframe и кормит её реальными данными через postMessage.
 * Диаграмма скачана как готовый макет и адаптирована под наши типы кампаний (§13.13).
 * iframe изолирует тяжёлый WebGPU-контекст от React (нет конфликтов бандлера/SSR).
 */
export function Chart3D({ data, height = 460 }: { data: Chart3DData; height?: number }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  const post = () => {
    const w = ref.current?.contentWindow
    if (!w) return
    // src того же origin → таргетим свой origin (не '*')
    w.postMessage({ type: 'ig-stats', ...dataRef.current }, window.location.origin)
  }

  // iframe сообщает о готовности (его скрипт стартует) → шлём данные
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data?.type === 'ig-stats-ready') post()
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // репост только при РЕАЛЬНОМ изменении значений (data — новый объект каждый рендер)
  const dataKey = JSON.stringify(data)
  useEffect(() => { post() }, [dataKey])

  return (
    <iframe
      ref={ref}
      src="/stats3d/index.html"
      title="3D-статистика по типам кампаний"
      onLoad={post}
      style={{ width: '100%', height, border: 'none', display: 'block', borderRadius: 16 }}
    />
  )
}
