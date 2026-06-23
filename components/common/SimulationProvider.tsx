'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'

/** Periodically advances active triggers so stats and responses feel live. */
export default function SimulationProvider() {
  const tick = useStore((s) => s.tick)
  useEffect(() => {
    const i = setInterval(() => tick(), 3500)
    return () => clearInterval(i)
  }, [tick])
  return null
}
