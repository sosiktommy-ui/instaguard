/**
 * Спокойный фон приложения.
 *
 * Раньше здесь была 3D-сеть Vanta NET (WebGL) поверх ярких анимированных орбов —
 * это слишком «кричало» и отвлекало от контента. Теперь — очень мягкая статичная
 * подсветка по углам (едва заметная), чтобы стеклянным карточкам было что мягко
 * размывать, но без движения, без WebGL и без нагрузки.
 *
 * Хотите совсем плоский белый фон — просто верните здесь `return null`.
 */
export default function VantaBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Холодная подсветка сверху-слева */}
      <div
        className="absolute"
        style={{
          top: '-22%',
          left: '-12%',
          width: '55vw',
          height: '55vw',
          background: 'radial-gradient(circle, rgba(0,113,227,0.08), transparent 70%)',
          filter: 'blur(90px)',
        }}
      />
      {/* Фиолетовая подсветка снизу-справа */}
      <div
        className="absolute"
        style={{
          bottom: '-26%',
          right: '-14%',
          width: '50vw',
          height: '50vw',
          background: 'radial-gradient(circle, rgba(94,92,230,0.07), transparent 70%)',
          filter: 'blur(100px)',
        }}
      />
    </div>
  )
}
