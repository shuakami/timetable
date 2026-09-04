import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, type MotionValue } from 'motion/react'
import { hasNativePickers, nativePickDate, nativePickOption, nativePickTime } from './widgets'

/* 动画参数：与 lexicon 一致 */
export const SPRING = { type: 'spring', bounce: 0.2, duration: 0.6 } as const
export const SLIDE = { type: 'tween', ease: [0.25, 1, 0.5, 1], duration: 0.4 } as const
export const SHEET = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.3 } as const
export const FADE = { duration: 0.2 } as const
/* 长按抬起/落下：进出走同一条曲线，阴影跟着一起消 */
export const LIFT = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.24 } as const

/* 与原型一致的视觉基元 */

export const dockStyle: React.CSSProperties = {
  background: 'var(--c-dock)',
  border: '1px solid var(--c-dock-line)',
  boxShadow: 'var(--c-dock-shadow)',
}

export function tint(color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, var(--c-surface))`
}

export const WD = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const WD_SHORT = ['', '一', '二', '三', '四', '五', '六', '日']
export const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`

export const NAV_ITEMS: [React.ReactNode, string][] = [
  [<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" key="h" />, '今天'],
  [<g key="c"><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M3 9h18M8 2v4M16 2v4" /></g>, '课表'],
  [<g key="t"><path d="M9 11.5 11 14l4-5" /><rect x="3.5" y="4" width="17" height="16" rx="4" /></g>, '待办'],
  [<g key="s"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></g>, '我的'],
]

export function Nav({ active, onTab, hidden }: { active: number; onTab: (i: number) => void; hidden?: boolean }) {
  return (
    <motion.div
      animate={{ y: hidden ? 130 : 0, opacity: hidden ? 0 : 1 }}
      transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
      className="pointer-events-none absolute inset-x-0 bottom-[max(24px,env(safe-area-inset-bottom))] z-[8] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex w-[92%] items-center justify-between rounded-full p-[5px]" style={dockStyle}>
        {NAV_ITEMS.map(([ic, label], i) => {
          const on = i === active
          return (
            <button
              key={label}
              onClick={() => onTab(i)}
              className="relative flex flex-1 flex-col items-center gap-[2px] px-1 pt-[6px] pb-[5px] transition-transform duration-150 active:scale-[.94]"
            >
              {on && (
                <motion.i
                  layoutId="nav-indicator"
                  className="absolute inset-x-[1px] inset-y-0 rounded-full bg-(--c-accent-soft)"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <svg viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--c-accent)' : 'var(--c-ink)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="relative z-10 h-[19px] w-[19px] transition-colors duration-200">{ic}</svg>
              <span className={`relative z-10 text-[9.5px] font-bold transition-colors duration-200 ${on ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{label}</span>
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-(--c-surface) p-5 ${className}`}>{children}</div>
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19 8 12l7-7" /></svg>
    </button>
  )
}

/* 顶部标题区的白色半透明层：越靠上越白、越模糊，往下是连续的梯度而不是硬边。
   多层 backdrop-filter 叠放，每层带一条渐变遮罩让模糊半径连续过渡，不出硬边。
   每层 [模糊半径, 遮罩开始消退的位置%, 完全消退的位置%] */
const BLUR_BANDS: [number, number, number][] = [
  [1, 70, 100],
  [2, 56, 92],
  [4, 42, 78],
  [8, 26, 62],
  [14, 8, 46],
]

const VEIL = 'linear-gradient(to bottom, rgb(var(--c-bg-rgb) / .84) 0%, rgb(var(--c-bg-rgb) / .74) 58%, rgb(var(--c-bg-rgb) / .28) 86%, rgb(var(--c-bg-rgb) / 0) 100%)'

/** 最近的可滚动祖先 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** 所在滚动容器的 scrollTop；未滚动时为 0 */
export function useScrollTop(ref: React.RefObject<HTMLElement | null>) {
  const [top, setTop] = useState(0)
  useEffect(() => {
    const sc = scrollParent(ref.current)
    if (!sc) return
    const on = () => setTop(sc.scrollTop)
    on()
    sc.addEventListener('scroll', on, { passive: true })
    return () => sc.removeEventListener('scroll', on)
  }, [ref])
  return top
}

/** 羽化随滚动距离渐现：前 24px 内 ease-out 到 1 */
export const VEIL_RANGE = 24
export const veilProgress = (top: number) => {
  const t = Math.min(1, Math.max(0, top / VEIL_RANGE))
  return 1 - (1 - t) * (1 - t)
}

/** 滚动容器驱动的羽化透明度：MotionValue 直接写样式，不走 React 重渲染 */
export function useVeilOpacity(ref: React.RefObject<HTMLElement | null>, offset: () => number = () => 0) {
  const mv = useMotionValue(0)
  useEffect(() => {
    const sc = scrollParent(ref.current)
    if (!sc) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      /* 每帧写一个肉眼不可见的新值：Android WebView 的合成器只在属性树有改动时重新采样 backdrop，
         纯合成线程滚动（慢滑）不会触发，模糊层就停在旧画面上 */
      raf = requestAnimationFrame(() => mv.set(veilProgress(sc.scrollTop - offset()) - (sc.scrollTop % 97) * 1e-6))
    }
    on()
    sc.addEventListener('scroll', on, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      sc.removeEventListener('scroll', on)
    }
  }, [ref, mv])
  return mv
}

export function TopVeil({ bleed = 0, feather = 44, progress = 1 }: {
  bleed?: number
  feather?: number
  progress?: number | MotionValue<number>
}) {
  return (
    /* 透明度写在每个子层上而不是父层：父层 opacity<1 会成为 backdrop root，模糊层就采样不到底下内容 */
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-[-1]"
      style={{ left: -bleed, right: -bleed, bottom: -feather }}
    >
      {BLUR_BANDS.map(([r, a, b]) => {
        const mask = `linear-gradient(to bottom, #000 0%, #000 ${a}%, rgba(0,0,0,0) ${b}%)`
        return (
          <motion.div
            key={r}
            className="absolute inset-0"
            style={{
              opacity: progress,
              backdropFilter: `blur(${r}px)`,
              WebkitBackdropFilter: `blur(${r}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        )
      })}
      <motion.div className="absolute inset-0" style={{ background: VEIL, opacity: progress }} />
    </div>
  )
}

/** 底栏后面的渐变遮挡：底色向上淡出，再叠一点轻微的模糊过渡 */
const BOTTOM_BANDS: [number, number, number][] = [
  [1, 60, 100],
  [2, 40, 80],
  [4, 18, 58],
]

const BOTTOM_VEIL = 'linear-gradient(to top, var(--c-bg) 0%, var(--c-bg) 42%, rgb(var(--c-bg-rgb) / .85) 66%, rgb(var(--c-bg-rgb) / 0) 100%)'

export function BottomVeil({ height }: { height: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[7]" style={{ height }}>
      {BOTTOM_BANDS.map(([r, a, b]) => {
        const mask = `linear-gradient(to top, #000 0%, #000 ${a}%, rgba(0,0,0,0) ${b}%)`
        return (
          <div
            key={r}
            className="absolute inset-0"
            style={{ backdropFilter: `blur(${r}px)`, WebkitBackdropFilter: `blur(${r}px)`, maskImage: mask, WebkitMaskImage: mask }}
          />
        )
      })}
      <div className="absolute inset-0" style={{ background: BOTTOM_VEIL }} />
    </div>
  )
}

/** 固定在滚动容器顶部的标题区：内容从它下面滑过去，标题本身不动；羽化只在滚动后出现 */
export function StickyHead({ children, bleed = 0, feather, className = '' }: {
  children: React.ReactNode
  bleed?: number
  feather?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const veil = useVeilOpacity(ref)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [h, setH] = useState(0)
  /* 标题区挂到滚动容器外层：backdrop-filter 不在 sticky 里，慢滚也能实时取到下面的内容 */
  useLayoutEffect(() => {
    const sc = scrollParent(ref.current)
    setHost((ref.current?.closest('[data-veil-host]') as HTMLElement | null) ?? sc?.parentElement ?? null)
  }, [])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    setH(el.offsetHeight)
    return () => ro.disconnect()
  }, [host])
  const head = (
    <div ref={box} className={`absolute inset-x-0 top-0 z-[30] isolate pt-[max(52px,calc(env(safe-area-inset-top)+22px))] pb-3 ${className}`}>
      <TopVeil bleed={bleed} feather={feather} progress={veil} />
      {children}
    </div>
  )
  return (
    <>
      <div ref={ref} style={{ height: h }} />
      {host ? createPortal(head, host) : null}
    </>
  )
}

export function TopBar({ title, sub, onBack, trail }: { title: string; sub?: string; onBack?: () => void; trail?: React.ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null)
  const top = useScrollTop(h1)
  /* 大标题整段滑进羽化层后，小标题接在返回按钮右侧 */
  const spacer = h1.current?.previousElementSibling as HTMLElement | null | undefined
  const sc = scrollParent(h1.current)
  const passed =
    top > 0 && !!h1.current && !!spacer && !!sc && h1.current.getBoundingClientRect().bottom <= sc.getBoundingClientRect().top + spacer.offsetHeight
  return (
    <>
      <StickyHead className="px-5 pb-1">
        <div className="flex h-9 items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {onBack ? <BackButton onClick={onBack} /> : <span />}
            <motion.div
              aria-hidden={!passed}
              initial={false}
              animate={{ opacity: passed ? 1 : 0, y: passed ? 0 : 6 }}
              transition={FADE}
              className="truncate text-[17px] font-bold tracking-[-.01em] text-(--c-ink)"
            >
              {title}
            </motion.div>
          </div>
          {trail}
        </div>
      </StickyHead>
      <h1 ref={h1} className="mt-4 text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">{title}</h1>
      {sub && <div className="mt-1.5 text-[13px] leading-[1.5] font-medium text-(--c-ink4)">{sub}</div>}
    </>
  )
}

export function Chips({ items, active, onPick }: { items: string[]; active: number; onPick: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <button
          key={t}
          onClick={() => onPick(i)}
          className={`rounded-[9px] px-2.5 py-[6px] text-[12px] font-bold transition-colors ${i === active ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-surface) text-(--c-ink3)'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

export function Field({ k, children, sub }: { k: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline px-4 py-3">
      <span className="w-[62px] flex-none text-[12.5px] font-medium text-(--c-ink4)">{k}</span>
      <div className="min-w-0 flex-1">
        {children}
        {sub && <div className="mt-1 text-[11.5px] font-medium text-(--c-ink4)">{sub}</div>}
      </div>
    </div>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-transparent text-[14px] font-semibold text-(--c-ink) outline-none placeholder:font-medium placeholder:text-(--c-ink5) ${props.className ?? ''}`}
    />
  )
}

const pickerBtn = 'block w-full bg-transparent text-left text-[14px] font-semibold tabular-nums text-(--c-ink) outline-none'

/** 日期：Android 上走系统选择对话框，其余环境用 input[type=date] */
export function DateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  if (!hasNativePickers()) {
    return <TextInput type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className={className} />
  }
  return (
    <button type="button" className={`${pickerBtn} ${className ?? ''}`} onClick={() => void nativePickDate(value).then((v) => v && onChange(v))}>
      {value ? value.replace(/-/g, '/') : <span className="font-medium text-(--c-ink5)">选择日期</span>}
    </button>
  )
}

export function TimeInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  if (!hasNativePickers()) {
    return <TextInput type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className={className} />
  }
  return (
    <button type="button" className={`${pickerBtn} ${className ?? ''}`} onClick={() => void nativePickTime(value).then((v) => v && onChange(v))}>
      {value || <span className="font-medium text-(--c-ink5)">选择时间</span>}
    </button>
  )
}

/** 单选：Android 上走系统列表对话框，其余环境用 select */
export function SelectInput({ value, options, onChange, title, className }: { value: string; options: [string, string][]; onChange: (v: string) => void; title?: string; className?: string }) {
  const cls = `${pickerBtn} ${className ?? ''}`
  if (!hasNativePickers()) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    )
  }
  const idx = options.findIndex(([v]) => v === value)
  return (
    <button
      type="button"
      className={cls}
      onClick={() => void nativePickOption(options.map(([, l]) => l), idx, title).then((i) => { if (i != null) onChange(options[i][0]) })}
    >
      {options[idx]?.[1] ?? options[0]?.[1] ?? ''}
    </button>
  )
}

export function Row({ title, desc, right, onClick, danger, active }: { title: string; desc?: string; right?: React.ReactNode; onClick?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-(--c-bg) ${active ? 'bg-(--c-accent-soft)' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-bold ${danger ? 'text-(--c-danger)' : active ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{title}</div>
        {desc && <div className="mt-0.5 text-[12px] font-medium text-(--c-ink4)">{desc}</div>}
      </div>
      {right ?? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.4" strokeLinecap="round" className="ml-3 flex-none"><path d="m9 5 7 7-7 7" /></svg>
      )}
    </button>
  )
}

export function EmptyArt({ kind }: { kind: 'free' | 'none' }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="h-[40px] w-[40px]">
      {kind === 'free' ? (
        <>
          <rect x="5" y="9" width="30" height="26" rx="7" style={{ stroke: 'var(--c-line)' }} strokeWidth="1.6" />
          <path d="M13 6v5M27 6v5" style={{ stroke: 'var(--c-line)' }} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 22.5 18 26.5l8-8" style={{ stroke: 'var(--c-accent-line)' }} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="5" y="9" width="30" height="26" rx="7" style={{ stroke: 'var(--c-line)' }} strokeWidth="1.6" strokeDasharray="3.5 3.5" />
          <path d="M13 6v5M27 6v5" style={{ stroke: 'var(--c-line)' }} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M20 17v9M15.5 21.5h9" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

export function EmptyBlock({ kind, title, desc, actions }: { kind: 'free' | 'none'; title: string; desc?: string; actions?: [string, () => void][] }) {
  return (
    <div className="flex flex-col items-center px-8 text-center">
      <EmptyArt kind={kind} />
      <div className="mt-4 text-[17px] font-extrabold tracking-[-.02em] text-(--c-ink)">{title}</div>
      {desc && <div className="mt-2 text-[13px] leading-[1.6] font-medium text-(--c-ink4)">{desc}</div>}
      {actions && actions.length > 0 && (
        <div className="mt-5 flex items-center gap-5">
          {actions.map(([label, fn], i) => (
            <button key={label} onClick={fn} className={`text-[13px] font-bold ${i === 0 ? 'text-(--c-accent)' : 'text-(--c-ink3)'}`}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/* 底部抽屉（照 vaul 的做法）：只有一个合成层，进出与拖拽都只改这一层的 transform；
   遮罩的透明度跟着抽屉位置走；拖拽期间直接写 style，不经过 React；松手后按 vaul 的阈值决定关闭或回弹 */
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const SHEET_MS = 0.5

/** 当前打开的抽屉的关闭函数，最上层在末尾；系统返回先关它们 */
const openSheets: (() => void)[] = []
export function closeTopSheet(): boolean {
  const top = openSheets[openSheets.length - 1]
  if (!top) return false
  top()
  return true
}

const CLOSE_RATIO = 0.25
const CLOSE_VELOCITY = 0.4 /* px/ms */

export function Sheet({
  children,
  onClose,
  className = '',
  header,
  footer,
  dismissRef,
}: {
  children: React.ReactNode
  onClose: () => void
  className?: string
  header?: React.ReactNode
  footer?: React.ReactNode
  dismissRef?: React.MutableRefObject<(() => void) | null>
}) {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const run = (to: number, opacity: number, duration = SHEET_MS) => {
    const el = panel.current
    const sc = scrim.current
    if (!el || !sc) return Promise.resolve()
    const a = animate(el, { transform: `translate3d(0,${to}px,0)` }, { duration, ease: SHEET_EASE })
    animate(sc, { opacity }, { duration, ease: SHEET_EASE })
    return a.then(() => {})
  }

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    const h = panel.current?.offsetHeight ?? window.innerHeight
    void run(h, 0).then(() => onCloseRef.current())
  }, [])
  if (dismissRef) dismissRef.current = close

  useLayoutEffect(() => {
    const el = panel.current
    const sc = scrim.current
    if (!el || !sc) return
    el.style.transform = `translate3d(0,${el.offsetHeight}px,0)`
    sc.style.opacity = '0'
    void run(0, 1)
  }, [])

  useEffect(() => {
    openSheets.push(close)
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', h)
    return () => {
      const i = openSheets.lastIndexOf(close)
      if (i >= 0) openSheets.splice(i, 1)
      window.removeEventListener('keydown', h)
    }
  }, [close])

  /* 握把拖拽 */
  const drag = useRef<{ y: number; t: number; h: number; last: number; lastT: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    if (closing.current) return
    const el = panel.current
    if (!el) return
    el.getAnimations().forEach((a) => a.cancel())
    scrim.current?.getAnimations().forEach((a) => a.cancel())
    el.style.transform = 'translate3d(0,0,0)'
    if (scrim.current) scrim.current.style.opacity = '1'
    drag.current = { y: e.clientY, t: performance.now(), h: el.offsetHeight, last: 0, lastT: performance.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = panel.current
    if (!d || !el) return
    let dy = e.clientY - d.y
    /* 往上拉：像 vaul 一样阻尼，只走一点 */
    if (dy < 0) dy = -Math.pow(-dy, 0.5) * 0.8
    el.style.transform = `translate3d(0,${dy}px,0)`
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / d.h))
    d.last = dy
    d.lastT = performance.now()
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dy = e.clientY - d.y
    const dt = Math.max(1, performance.now() - d.t)
    const v = dy / dt
    if (dy > d.h * CLOSE_RATIO || v > CLOSE_VELOCITY) {
      closing.current = true
      void run(d.h, 0, Math.min(SHEET_MS, Math.max(0.2, ((d.h - dy) / d.h) * SHEET_MS))).then(() => onCloseRef.current())
    } else {
      void run(0, 1)
    }
  }

  return (
    <>
      <div
        ref={scrim}
        className="absolute inset-0 z-[60]"
        style={{ background: 'var(--c-scrim)', opacity: 0 }}
        onClick={close}
      />
      <div
        ref={panel}
        className={`absolute inset-x-0 bottom-0 z-[70] flex max-h-[88%] flex-col rounded-t-[26px] bg-(--c-surface) pt-2 will-change-transform`}
        style={{ transform: 'translate3d(0,100%,0)', touchAction: 'none' }}
      >
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="flex-none cursor-grab touch-none py-1.5"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-(--c-line)" />
        </div>
        {header && <div className="flex-none">{header}</div>}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] ${className}`} style={{ touchAction: 'pan-y' }}>
          {children}
        </div>
        <div className="flex-none pb-[max(22px,env(safe-area-inset-bottom))]">{footer}</div>
      </div>
    </>
  )
}

/* 全屏内页：从右侧推入，盖住底栏 */
export function Page({ children, className = '', root }: { children: React.ReactNode; className?: string; onBack?: () => void; root?: boolean }) {
  return (
    <motion.div
      initial={root ? false : { transform: 'translateX(100%)' }}
      animate={{ transform: 'translateX(0%)' }}
      exit={{ transform: 'translateX(100%)' }}
      transition={SLIDE}
      className="absolute inset-0 z-[40] will-change-transform"
    >
      <div data-veil-host className={`absolute inset-0 flex flex-col overflow-hidden bg-(--c-bg) ${className}`}>
        {children}
      </div>
    </motion.div>
  )
}

export interface Rect { x: number; y: number; w: number; h: number }

/** 长按时被按住的卡片：在遮罩之上原位抬起的一份副本 */
export interface Ghost {
  el: HTMLElement
  rect: Rect
  radius: number
  scale: number
  /** 课程色描边；不传则只做白卡抬起 */
  color?: string
  bg?: string
  /** 副本四周向外扩出的内边距（把内容块包成一张卡） */
  pad?: number
}

const MENU_SPRING = { type: 'spring', bounce: 0.28, duration: 0.42 } as const
const MENU_OUT = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.18 } as const

/* 长按后的浮层菜单：卡片副本抬到遮罩上，菜单从卡片一侧弹出 */
export function Popover({ anchor, ghost, onClose, children }: { anchor: Rect; ghost?: Ghost; onClose: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const close = () => setOpen(false)
  const shellW = Math.min(window.innerWidth, 430)
  const shellH = window.innerHeight
  const below = anchor.y + anchor.h + 10
  const originTop = shellH - below > 300
  const ghostHost = useRef<HTMLDivElement>(null)
  const pad = ghost?.pad ?? 0
  useLayoutEffect(() => {
    const host = ghostHost.current
    if (!host || !ghost) return
    const clone = ghost.el.cloneNode(true) as HTMLElement
    clone.style.pointerEvents = 'none'
    clone.style.transform = 'none'
    clone.style.opacity = '1'
    clone.style.margin = '0'
    clone.style.position = 'absolute'
    clone.style.top = `${pad}px`
    clone.style.left = `${pad}px`
    clone.style.width = `${ghost.rect.w}px`
    clone.style.height = `${ghost.rect.h}px`
    host.replaceChildren(clone)
  }, [ghost, pad])
  return (
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="absolute inset-0 z-[60] bg-(--c-bg)/72"
            onClick={close}
          />
          {ghost && (
            <motion.div
              key="ghost"
              ref={ghostHost}
              initial={{ transform: 'scale(1)' }}
              animate={{ transform: `scale(${ghost.scale})` }}
              exit={{ transform: 'scale(1)', opacity: 0, transition: { transform: MENU_OUT, opacity: FADE } }}
              transition={{ transform: MENU_SPRING }}
              className="pointer-events-none absolute z-[65] overflow-hidden will-change-transform"
              style={{
                top: ghost.rect.y - pad,
                left: ghost.rect.x - pad,
                width: ghost.rect.w + pad * 2,
                height: ghost.rect.h + pad * 2,
                borderRadius: ghost.radius,
                background: ghost.bg,
                boxShadow: ghost.color
                  ? `inset 0 0 0 1.5px ${ghost.color}, var(--c-lift-shadow)`
                  : 'var(--c-lift-shadow)',
                transformOrigin: originTop ? 'center bottom' : 'center top',
              }}
            />
          )}
          <motion.div
            key="menu"
            initial={{ opacity: 0, transform: 'scale(0.55)' }}
            animate={{ opacity: 1, transform: 'scale(1)' }}
            exit={{ opacity: 0, transform: 'scale(0.9)', transition: { transform: MENU_OUT, opacity: { duration: 0.14 } } }}
            transition={{ transform: MENU_SPRING, opacity: { duration: 0.14 } }}
            style={{
              top: originTop ? below : undefined,
              bottom: originTop ? undefined : Math.max(12, shellH - anchor.y + 10),
              left: Math.min(Math.max(12, anchor.x + anchor.w / 2 - 113), shellW - 238),
              transformOrigin: originTop ? 'top center' : 'bottom center',
              boxShadow: 'var(--c-menu-shadow)',
            }}
            className="absolute z-[70] w-[226px] overflow-hidden rounded-[17px] border border-(--c-menu-line) bg-(--c-surface) py-2 will-change-transform"
            onClick={close}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function SheetHead({ title, sub, trail }: { title: string; sub?: string; trail?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-5 pt-1 pb-2.5">
      <div className="min-w-0">
        <div className="truncate text-[17px] font-extrabold tracking-[-.02em] text-(--c-ink)">{title}</div>
        {sub && <div className="mt-1 truncate text-[12px] font-medium text-(--c-ink4)">{sub}</div>}
      </div>
      {trail}
    </div>
  )
}

export function MenuRow({ icon, title, desc, onClick, danger, first }: { icon: React.ReactNode; title: string; desc?: string; onClick: () => void; danger?: boolean; first?: boolean }) {
  return (
    <button onClick={onClick} className={`mx-3 flex w-[calc(100%-24px)] items-center rounded-[13px] px-3 py-[10px] text-left transition-colors active:bg-(--c-surface2) ${first ? 'bg-(--c-bg)' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke={danger ? 'var(--c-danger)' : 'var(--c-ink2)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mr-3 h-[17px] w-[17px] flex-none">{icon}</svg>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[14px] font-medium ${danger ? 'text-(--c-danger)' : 'text-(--c-ink)'}`}>{title}</div>
        {desc && <div className="mt-[2px] truncate text-[11.5px] font-medium text-(--c-ink4)">{desc}</div>}
      </div>
    </button>
  )
}

export function TextAction({ children, onClick, tone = 'brand', disabled }: { children: React.ReactNode; onClick?: () => void; tone?: 'brand' | 'mute' | 'danger'; disabled?: boolean }) {
  const color = tone === 'brand' ? 'text-(--c-accent)' : tone === 'danger' ? 'text-(--c-danger)' : 'text-(--c-ink3)'
  return (
    <button onClick={onClick} disabled={disabled} className={`flex-none text-[13px] font-bold whitespace-nowrap transition-opacity active:opacity-60 disabled:opacity-30 ${color}`}>{children}</button>
  )
}

/* 底部主操作：大号实心主题色 */
export function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-[18px] bg-(--c-accent) py-[15px] text-[15px] font-bold text-white transition-transform duration-150 active:scale-[.985] disabled:bg-(--c-line) disabled:text-(--c-ink5)"
    >
      {children}
    </button>
  )
}

export function PopHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-3.5 pt-1 pb-2.5">
      <div className="truncate text-[12.5px] font-medium text-(--c-ink4)">{title}{sub ? `　${sub}` : ''}</div>
    </div>
  )
}

export function PopItem({ icon, title, danger, onClick }: { icon: React.ReactNode; title: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mx-2 flex w-[calc(100%-16px)] items-center rounded-[11px] px-2.5 py-[9px] text-left transition-colors active:bg-(--c-surface2)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke={danger ? 'var(--c-danger)' : 'var(--c-ink2)'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mr-3 h-[17px] w-[17px] flex-none">{icon}</svg>
      <span className={`truncate text-[14px] font-medium ${danger ? 'text-(--c-danger)' : 'text-(--c-ink)'}`}>{title}</span>
    </button>
  )
}

export const ICON = {
  bell: <g><path d="M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6z" /><path d="M4 4l16 16" /></g>,
  check: <path d="M20 6 9 17l-5-5" />,
  leave: <g><rect x="3.5" y="4" width="17" height="16" rx="4" /><path d="M9 12h6" /></g>,
  clock: <g><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>,
  edit: <path d="M4 20h4L20 8l-4-4L4 16z" />,
  undo: <g><path d="M4 10h9a5 5 0 0 1 0 10H8" /><path d="m4 10 4-4M4 10l4 4" /></g>,
  ban: <g><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></g>,
  info: <g><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></g>,
  trash: <g><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></g>,
}
