import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { stickerSrc } from '../domain/stickers'

const ON_KEY = 'tt.stickers'
let stickersOn = localStorage.getItem(ON_KEY) !== '0'
const onListeners = new Set<() => void>()

/** 课程贴纸开关（Beta）：默认开，关掉后所有 Sticker 不渲染 */
export function setStickersOn(on: boolean) {
  stickersOn = on
  if (on) localStorage.removeItem(ON_KEY)
  else localStorage.setItem(ON_KEY, '0')
  onListeners.forEach((l) => l())
}

export function useStickersOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      onListeners.add(l)
      return () => onListeners.delete(l)
    },
    () => stickersOn,
  )
}

interface Art { vb: string; size: number; body: string }

const arts = new Map<string, Art | null>()
const loading = new Map<string, Promise<Art | null>>()

function parse(text: string): Art | null {
  const open = /<svg[^>]*>/.exec(text)
  if (!open) return null
  const vb = /viewBox="([^"]+)"/.exec(open[0])?.[1] ?? '0 0 128 128'
  const size = Number(vb.split(/\s+/)[2]) || 128
  const body = text.slice(open.index + open[0].length).replace(/<\/svg>\s*$/, '')
  return { vb, size, body }
}

function load(id: string): Promise<Art | null> {
  const cached = loading.get(id)
  if (cached) return cached
  const p = fetch(stickerSrc(id))
    .then((r) => (r.ok ? r.text() : ''))
    .then((t) => parse(t))
    .catch(() => null)
    .then((a) => {
      arts.set(id, a)
      return a
    })
  loading.set(id, p)
  return p
}

/** 学科贴纸：原版图形垫一层刀切边，浅色白边、深色同调暗边 */
export function Sticker({ id, size, tilt = 0, hidden, className = '', style }: {
  id: string
  size: number
  tilt?: number
  hidden?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const on = useStickersOn()
  const [art, setArt] = useState<Art | null>(() => arts.get(id) ?? null)
  useEffect(() => {
    const hit = arts.get(id)
    if (hit !== undefined) {
      setArt(hit)
      return
    }
    let on = true
    load(id).then((a) => on && setArt(a))
    return () => {
      on = false
    }
  }, [id])
  if (!on || !art) return null
  return (
    <span
      data-sticker
      aria-hidden
      className={`sticker ${className}`}
      style={{ width: size, height: size, transform: tilt ? `rotate(${tilt}deg)` : undefined, ...style, opacity: hidden ? 0 : style?.opacity ?? 1 }}
    >
      <svg width={size} height={size} viewBox={art.vb}>
        <g className="sticker-cut" style={{ strokeWidth: `calc(${art.size}px * var(--c-sticker-edge-w))` }} dangerouslySetInnerHTML={{ __html: art.body }} />
        <g dangerouslySetInnerHTML={{ __html: art.body }} />
      </svg>
    </span>
  )
}

/** 同一课名的贴纸每次都歪同一个角度 */
export function stickerTilt(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const tilts = [-8, 6, -5, 7, -9, 5, -6, 8]
  return tilts[Math.abs(h) % tilts.length]
}
