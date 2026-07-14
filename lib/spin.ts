// Разнообразие текста сообщений (анти-«одинаковое»): одинаковый текст всем = сильный
// спам/робот-сигнал Instagram. spintax {a|b|c} → случайный вариант (можно вложенно),
// плюс выбор случайного шаблона из нескольких. Так каждый директ получается разным.

/** Разворачивает spintax: «{Привет|Хай}, друг!» → «Хай, друг!». Вложенность до 6 уровней. */
export function spin(text: string): string {
  let s = String(text ?? '')
  for (let i = 0; i < 6 && s.includes('{'); i++) {
    let changed = false
    s = s.replace(/\{([^{}]*)\}/g, (_m, group: string) => {
      changed = true
      const opts = group.split('|')
      return opts[Math.floor(Math.random() * opts.length)]
    })
    if (!changed) break
  }
  return s
}

/**
 * Готовит текст сообщения: выбирает СЛУЧАЙНЫЙ шаблон из непустых → подставляет {{username}}
 * (это делаем ДО spin, чтобы значение не съелось спинтаксом) → разворачивает spintax.
 * Итог — разный текст для разных людей даже из одного набора.
 */
export function renderMessage(templates: unknown, username: string): string {
  const list = (Array.isArray(templates) ? templates : [templates])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
  if (!list.length) return ''
  const base = list[Math.floor(Math.random() * list.length)]
  return spin(base.replace(/\{\{username\}\}/gi, username)).trim()
}
