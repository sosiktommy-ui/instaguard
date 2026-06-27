import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="t" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0c1530" />
            <stop offset="1" stopColor="#05070f" />
          </linearGradient>
          <linearGradient id="n" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7df3ff" />
            <stop offset="0.5" stopColor="#39b6ff" />
            <stop offset="1" stopColor="#2f74ff" />
          </linearGradient>
        </defs>
        {/* tile */}
        <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#t)" />
        {/* glow layer */}
        <g stroke="#39b6ff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.55">
          <rect x="24" y="24" width="52" height="52" rx="16" />
          <circle cx="50" cy="50" r="13.5" />
        </g>
        {/* core layer */}
        <g stroke="#e6fcff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="24" y="24" width="52" height="52" rx="16" />
          <circle cx="50" cy="50" r="13.5" />
          <circle cx="68.5" cy="31.5" r="2.8" fill="#e6fcff" stroke="none" />
        </g>
      </svg>
    ),
    { ...size },
  )
}
