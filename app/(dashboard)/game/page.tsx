export default function GamePage() {
  return (
    <div
      className="fixed left-0 right-0 bottom-0"
      style={{ top: 64, zIndex: 5 }}
    >
      <iframe
        src="/game/index.html"
        className="w-full h-full border-0"
        allow="fullscreen"
        title="InstaGuard Command Center"
      />
    </div>
  )
}
