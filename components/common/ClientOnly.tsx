'use client'

import { useEffect, useState } from 'react'

/**
 * Renders children only after the component has mounted on the client.
 * Prevents hydration mismatches for state restored from localStorage.
 */
export default function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-32 text-subt">
        <div className="h-6 w-6 rounded-full border-2 border-line border-t-brand animate-spin" />
      </div>
    )
  }
  return <>{children}</>
}
