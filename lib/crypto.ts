// Шифрование чувствительных полей at-rest (AES-256-GCM), ключ — ENCRYPTION_KEY (32 байта,
// уже задан на Railway, см. plan.md §11 — переменная была объявлена, но нигде не
// использовалась: sessionData/browserState/emailPassword лежали в БД открытым текстом,
// хотя комментарии в схеме обещали шифрование). Используется точечно (см. вызывающий код) —
// не весь at-rest слой сразу: browserState/sessionData шифровать полностью — отдельное
// решение (plan.md §12, много точек чтения на живом пути входа/действий, риск регресса).
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const PREFIX = 'enc1:' // маркер «это шифротекст», чтобы decrypt() не пытался расшифровать старый plaintext

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? ''
  if (raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY не задан или не 32 байта — шифрование недоступно')
  }
  return Buffer.from(raw, 'utf8')
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Расшифровать. Если значение НЕ похоже на наш шифротекст (старая plaintext-запись до
 * внедрения шифрования) — вернуть как есть, чтобы не ронять существующие данные. */
export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

export function encryptionConfigured(): boolean {
  return (process.env.ENCRYPTION_KEY ?? '').length === 32
}
