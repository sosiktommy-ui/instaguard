'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface Crumb { label: string; onClick?: () => void }

const Ctx = createContext<{ crumbs: Crumb[]; setCrumbs: (c: Crumb[]) => void }>({
  crumbs: [],
  setCrumbs: () => {},
})

/** Провайдер хлебных крошек: страница задаёт путь, TopNav его показывает. */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  return <Ctx.Provider value={{ crumbs, setCrumbs }}>{children}</Ctx.Provider>
}

export function useBreadcrumbs() {
  return useContext(Ctx)
}

/**
 * Хелпер для страниц: задаёт крошки на время жизни экрана и очищает при уходе.
 * Передавайте стабильный массив (или мемоизируйте зависимости).
 */
export function useSetBreadcrumbs(crumbs: Crumb[], deps: unknown[]) {
  const { setCrumbs } = useBreadcrumbs()
  useEffect(() => {
    setCrumbs(crumbs)
    return () => setCrumbs([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
