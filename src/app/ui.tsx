import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, type MotionValue } from 'motion/react'
import { weekdayOf } from '../domain/dates'

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

/** 日期：点开自绘月历卡 */
export function DateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`${pickerBtn} ${className ?? ''}`} onClick={() => setOpen(true)}>
        {value ? value.replace(/-/g, '/') : <span className="font-medium text-(--c-ink5)">选择日期</span>}
      </button>
      {open && <DateSheet value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 时刻：点开自绘时:分滚轮卡 */
export function TimeInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`${pickerBtn} ${className ?? ''}`} onClick={() => setOpen(true)}>
        {value || <span className="font-medium text-(--c-ink5)">选择时间</span>}
      </button>
      {open && <TimeSheet value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 单选：点开自绘选择卡 */
export function SelectInput({ value, options, onChange, title, className }: { value: string; options: [string, string][]; onChange: (v: string) => void; title?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const idx = options.findIndex(([v]) => v === value)
  return (
    <>
      <button type="button" className={`${pickerBtn} ${className ?? ''}`} onClick={() => setOpen(true)}>
        {options[idx]?.[1] ?? options[0]?.[1] ?? ''}
      </button>
      {open && (
        <ActionSheet
          title={title ?? '选择'}
          groups={[options.map(([v, label]) => ({ title: label, selected: v === value, onClick: () => onChange(v) }))]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
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

export type EmptyKind = 'free' | 'none' | 'todo' | 'term' | 'holiday' | 'search'

export function EmptyArt({ kind }: { kind: EmptyKind }) {
  const art: Record<EmptyKind, React.ReactNode> = {
    free: (
      <>
        <rect x="6" y="9" width="36" height="32" rx="5" />
        <path d="M6 18h36M15 5v7M33 5v7" />
        <path d="m17 30 5 5 9-9" />
      </>
    ),
    none: (
      <>
        <rect x="6" y="9" width="36" height="32" rx="5" strokeDasharray="4 3.5" />
        <path d="M6 18h36M15 5v7M33 5v7" />
        <path d="M24 24v10M19 29h10" />
      </>
    ),
    todo: (
      <>
        <rect x="6" y="10" width="36" height="26" rx="4" />
        <path d="M6 30l10-9 8 7 6-5 12 10" />
        <circle cx="32" cy="18" r="3" />
        <path d="M14 42h20" />
      </>
    ),
    term: (
      <>
        <path d="M10 8h22l8 8v24a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
        <path d="M32 8v8h8" />
        <path d="m18 28 4 4 8-8" />
      </>
    ),
    holiday: (
      <>
        <circle cx="24" cy="20" r="7" />
        <path d="M24 5v4M24 31v4M9 20h4M35 20h4M13.4 9.4l2.8 2.8M31.8 27.8l2.8 2.8M13.4 30.6l2.8-2.8M31.8 12.2l2.8-2.8" />
        <path d="M6 42c6-5 12-5 18 0s12 5 18 0" />
      </>
    ),
    search: (
      <>
        <circle cx="21" cy="21" r="12" />
        <path d="m30 30 11 11" />
        <path d="M16 21h10" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 48 48" fill="none" style={{ stroke: 'var(--c-ink3)' }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[52px] w-[52px]">
      {art[kind]}
    </svg>
  )
}

export type EmptyAction = [label: string, onClick: () => void, icon?: React.ReactNode]

export function EmptyBlock({ kind, title, desc, actions, className = 'px-5', onSurface }: {
  kind: EmptyKind
  title: string
  desc?: string
  actions?: EmptyAction[]
  className?: string
  onSurface?: boolean
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <EmptyArt kind={kind} />
      <div className="mt-6 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">{title}</div>
      {desc && <div className="mt-2 text-[13.5px] leading-[1.55] font-medium text-(--c-ink3)">{desc}</div>}
      {actions && actions.length > 0 && (
        <div className="mt-5 flex items-center gap-2">
          {actions.map(([label, fn, icon], i) => (
            <button
              key={label}
              onClick={fn}
              className={`flex h-[34px] items-center gap-1.5 rounded-full text-[13px] font-bold transition-transform duration-150 active:scale-[.96] ${i === 0 ? 'bg-(--c-accent) text-white' : `${onSurface ? 'bg-(--c-surface2)' : 'bg-(--c-surface)'} text-(--c-ink)`} ${icon ? 'pl-3 pr-3.5' : 'px-3.5'}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const CameraIcon = ({ size = 18, stroke = 'var(--c-ink)' }: { size?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ stroke }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
    <path d="M4 9a2.5 2.5 0 0 1 2.5-2.5H8l1.1-1.7c.3-.5.8-.8 1.4-.8h3c.6 0 1.1.3 1.4.8L16 6.5h1.5A2.5 2.5 0 0 1 20 9v7.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.6" r="3.1" />
  </svg>
)

export const ArrowUpIcon = ({ stroke = '#fff' }: { stroke?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
)

/** 胶囊里的文字上限（字数），超出截掉加“…” */
export const CHIP_MAX = 8
export function clipText(s: string, max = CHIP_MAX) {
  const chars = Array.from(s)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : s
}

/** 胶囊标签：课程、截止、分类；文字按字数截断 */
export function Chip({ color, children, tone = 'plain', onClick, shrink = false }: {
  color?: string
  children: React.ReactNode
  tone?: 'plain' | 'accent'
  onClick?: () => void
  /** 放在一行里时允许被挤窄（文字省略），不把同行其他控件顶出去 */
  shrink?: boolean
}) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={`inline-flex h-[30px] max-w-[160px] min-w-0 ${shrink ? 'shrink' : 'flex-none'} items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold ${tone === 'accent' ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-surface2) text-(--c-ink2)'} ${onClick ? 'transition-transform duration-150 active:scale-[.96]' : ''}`}
    >
      {color && <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} />}
      <span className="min-w-0 truncate">{typeof children === 'string' ? clipText(children) : children}</span>
    </Tag>
  )
}

/** 快速记录胶囊：相机 + 一句话，压在底栏上面；点文字后这个胶囊本身长成输入卡（共享 layoutId） */
export const COMPOSE_RADIUS = 26
export function composeLayoutId(courseId?: string) {
  return courseId ? `compose-${courseId}` : 'compose'
}

export function QuickBar({ onCamera, onText, placeholder = '新待办', layoutId = composeLayoutId() }: {
  onCamera: () => void
  onText: () => void
  placeholder?: string
  layoutId?: string
}) {
  return (
    <div className="absolute inset-x-4 bottom-[92px] z-[9]">
      <motion.div layoutId={layoutId} transition={SHEET} className="flex items-center gap-2 p-[6px] pr-3.5" style={{ ...dockStyle, borderRadius: COMPOSE_RADIUS }}>
        <button
          onClick={onCamera}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-(--c-surface2) transition-transform duration-150 active:scale-[.92]"
        >
          <CameraIcon />
        </button>
        <button onClick={onText} className="flex-1 pl-1 text-left text-[15px] font-medium text-(--c-ink4)">{placeholder}</button>
      </motion.div>
    </div>
  )
}

/** 日期条下的全天状态带：学期已结束、假期 */
export function WeekBand({ tone, title, meta }: { tone: 'gray' | 'amber'; title: string; meta: string }) {
  const c = tone === 'amber' ? '#C29155' : '#8A8E97'
  return (
    <div className="flex items-center gap-2 rounded-[8px] px-2.5 py-[6px]" style={{ background: tint(c, 12) }}>
      <i className="h-[14px] w-[3px] flex-none rounded-full" style={{ background: c }} />
      <span className="text-[11.5px] font-bold" style={{ color: `color-mix(in srgb, ${c} 80%, var(--c-ink-mix))` }}>{title}</span>
      <span className="ml-auto text-[10.5px] font-semibold tabular-nums" style={{ color: `color-mix(in srgb, ${c} 65%, var(--c-ink-mix))` }}>{meta}</span>
    </div>
  )
}

/** 停课的课：留在原时段的虚线幽灵块 */
export function GhostEvent({ name, color, top, h, note = '停课' }: {
  name: string
  color: string
  top: number
  h: number
  note?: string
}) {
  return (
    <div
      className="absolute inset-x-0 overflow-hidden rounded-[9px] border-[1.5px] border-dashed px-1 py-1.5 text-[9.5px] leading-[1.35] font-bold"
      style={{ top, height: h, borderColor: tint(color, 45), color: `color-mix(in srgb, ${color} 70%, var(--c-ink-mix))` }}
    >
      <span className="opacity-70">{name}</span>
      <div className="mt-0.5 text-[8.5px] leading-[1.3] font-semibold opacity-60">{note}</div>
    </div>
  )
}

/** 底栏上方的悬浮胶囊动作 */
export function FloatPills({ actions }: { actions: [string, () => void][] }) {
  return (
    <div className="absolute inset-x-0 bottom-[100px] z-[9] flex justify-center gap-2">
      {actions.map(([label, fn], i) => (
        <button
          key={label}
          onClick={fn}
          className={`flex h-[36px] items-center rounded-full px-4 text-[13px] font-bold transition-transform duration-150 active:scale-[.96] ${i === 0 ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}
          style={dockStyle}
        >
          {label}
        </button>
      ))}
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

/** 全屏覆盖层（图片查看等）也接系统返回：挂进同一个栈 */
export function useBackClose(close: () => void) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    const fn = () => ref.current()
    openSheets.push(fn)
    return () => {
      const i = openSheets.lastIndexOf(fn)
      if (i >= 0) openSheets.splice(i, 1)
    }
  }, [])
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
export function PrimaryButton({ children, onClick, disabled, onDark }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; onDark?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-[18px] bg-(--c-accent) py-[15px] text-[15px] font-bold text-white transition-transform duration-150 active:scale-[.985] ${onDark ? 'disabled:bg-white/12 disabled:text-white/35' : 'disabled:bg-(--c-line) disabled:text-(--c-ink5)'}`}
    >
      {children}
    </button>
  )
}

/* 底部选择/动作菜单：左上标题、右上圆形关闭；每行「图标 + 文案 + 右侧附注或勾」，选中项主题色；危险项红字 */
export interface ActionItem {
  title: string
  /** 左侧图标（svg 内容） */
  icon?: React.ReactNode
  /** 右侧灰色附注 */
  value?: string
  selected?: boolean
  danger?: boolean
  /** 点了不收起（多选） */
  keepOpen?: boolean
  /** 行尾用方框而不是勾 */
  multi?: boolean
  onClick: () => void
}

export function SheetClose({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-(--c-surface2) transition-transform duration-150 active:scale-[.92]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  )
}

export function SheetRow({ item, onPick }: { item: ActionItem; onPick: (it: ActionItem) => void }) {
  const tone = item.danger ? 'var(--c-danger)' : item.selected ? 'var(--c-accent)' : 'var(--c-ink2)'
  return (
    <button onClick={() => onPick(item)} className="flex h-[52px] w-full items-center rounded-[14px] px-3 text-left transition-colors active:bg-(--c-surface2)">
      {item.icon ? (
        <svg viewBox="0 0 24 24" fill="none" stroke={tone} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mr-3.5 h-[19px] w-[19px] flex-none">{item.icon}</svg>
      ) : (
        <span className="mr-3.5 h-[19px] w-[19px] flex-none rounded-full border-[1.8px] border-dashed border-(--c-ink5)" />
      )}
      <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${item.danger ? 'text-(--c-danger)' : 'text-(--c-ink)'}`}>{item.title}</span>
      {item.value != null && <span className="ml-3 flex-none text-[14px] font-medium tabular-nums text-(--c-ink4)">{item.value}</span>}
      {!item.danger && <Tick on={!!item.selected} multi={item.multi} className="ml-3" />}
    </button>
  )
}

/** 行尾选中标记：占位宽度固定，选不选都不挤动左边；多选是方框，单选是勾 */
export function Tick({ on, multi, className = '' }: { on: boolean; multi?: boolean; className?: string }) {
  if (multi) {
    return (
      <span
        className={`flex h-[20px] w-[20px] flex-none items-center justify-center rounded-[6px] border-[1.6px] transition-colors duration-150 ${on ? 'border-(--c-accent) bg-(--c-accent)' : 'border-(--c-ink5) bg-transparent'} ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`h-[12px] w-[12px] transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-0'}`}><path d="m5 13 4.5 4.5L19 7" /></svg>
      </span>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={`h-[16px] w-[16px] flex-none transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-0'} ${className}`}><path d="m5 13 4.5 4.5L19 7" /></svg>
  )
}

export function ActionSheet({ groups, onClose, title }: { groups: ActionItem[][]; onClose: () => void; title: string }) {
  const dismiss = useRef<(() => void) | null>(null)
  const pick = (it: ActionItem) => {
    it.onClick()
    if (!it.keepOpen) dismiss.current?.()
  }
  return (
    <Sheet onClose={onClose} dismissRef={dismiss} className="px-3 pb-2" header={<SheetHead title={title} trail={<SheetClose onClick={() => dismiss.current?.()} />} />}>
      {groups.filter((g) => g.length > 0).map((g, gi) => (
        <div key={gi} className={gi > 0 ? 'mt-2 border-t border-(--c-line) pt-2' : ''}>
          {g.map((it) => <SheetRow key={it.title} item={it} onPick={pick} />)}
        </div>
      ))}
    </Sheet>
  )
}

/* 滚轮：scroll-snap 列，中间一行为选中；上下淡出用叠在上面的渐变层而不是 mask-image（Android WebView 给滚动层建 mask 层时会闪一帧） */
const WHEEL_ROW = 40
export function Wheel({ items, index, onChange, className = '' }: { items: string[]; index: number; onChange: (i: number) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const settled = useRef(index)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && settled.current !== index) {
      el.scrollTop = index * WHEEL_ROW
      settled.current = index
    } else if (el && el.scrollTop !== index * WHEEL_ROW && timer.current == null) {
      el.scrollTop = index * WHEEL_ROW
    }
  }, [index])

  const onScroll = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      const el = ref.current
      if (!el) return
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / WHEEL_ROW)))
      settled.current = i
      if (i !== index) onChange(i)
    }, 80)
  }

  return (
    <div className={`relative ${className}`} style={{ height: WHEEL_ROW * 5 }}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[10px] bg-(--c-surface2)" style={{ height: WHEEL_ROW }} />
      <div
        ref={ref}
        onScroll={onScroll}
        className="relative h-full snap-y snap-mandatory overflow-y-auto [scrollbar-width:none]"
        style={{ paddingTop: WHEEL_ROW * 2, paddingBottom: WHEEL_ROW * 2 }}
      >
        {items.map((t, i) => (
          <div
            key={i}
            onClick={() => { if (ref.current) ref.current.scrollTo({ top: i * WHEEL_ROW, behavior: 'smooth' }) }}
            className={`flex snap-center items-center justify-center text-[16px] tabular-nums transition-colors ${i === index ? 'font-bold text-(--c-ink)' : 'font-medium text-(--c-ink4)'}`}
            style={{ height: WHEEL_ROW }}
          >
            {t}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: WHEEL_ROW * 1.5, background: 'linear-gradient(to bottom, var(--c-surface), transparent)' }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: WHEEL_ROW * 1.5, background: 'linear-gradient(to top, var(--c-surface), transparent)' }} />
    </div>
  )
}

/* ---------------- 月历 / 时刻滚轮 / 日期与时刻选择卡 ---------------- */

/** 同一区域内两层内容交叉淡入淡出的层：常驻合成层 + 200ms 透明度过渡 */
export const SWAP_LAYER = 'absolute inset-0 transition-opacity duration-200 ease-out will-change-[opacity]'

export const CAL_ROW = 42
/** 月历区域固定高度：月份行 + 星期行 + 六行日期；切成年月日滚轮时也用这个高度，不跳 */
export const CAL_H = 40 + 26 + CAL_ROW * 6
export const SWAP = { duration: 0.2 } as const

const pad2 = (n: number) => String(n).padStart(2, '0')
export const ymOf = (d: string) => d.slice(0, 7)
export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate()
export const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`
export const addDaysStr = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00`)
  x.setDate(x.getDate() + n)
  return ymd(x.getFullYear(), x.getMonth() + 1, x.getDate())
}
export const todayYmd = () => { const t = new Date(); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()) }
const shiftMonth = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7)) - 1 + n
  return `${y + Math.floor(m / 12)}-${pad2(((m % 12) + 12) % 12 + 1)}`
}
/** 六行七列，周一起；不足处用上月末与下月初补齐 */
function calendarCells(ym: string): string[] {
  const first = `${ym}-01`
  const lead = weekdayOf(first) - 1
  return Array.from({ length: 42 }, (_, i) => addDaysStr(first, i - lead))
}

const Chevron = ({ dir }: { dir: -1 | 1 }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir < 0 ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
  </svg>
)

/**
 * 月历：上面「‹ 2026年9月 ▾ ›」，点月份标题切成年/月/日滚轮；选中日主题色圆，今天主题色字。
 * 高度固定 CAL_H，月份切换左右滑一点并淡入。
 */
export function Calendar({ value, onChange, today = todayYmd() }: { value: string; onChange: (d: string) => void; today?: string }) {
  const d = value || today
  const [view, setView] = useState<'cal' | 'ym'>('cal')
  const [month, setMonth] = useState(ymOf(d))
  const [dir, setDir] = useState(1)
  const goMonth = (n: number) => { setDir(n); setMonth((x) => shiftMonth(x, n)) }
  const pick = (x: string) => {
    onChange(x)
    if (ymOf(x) !== month) { setDir(x > month ? 1 : -1); setMonth(ymOf(x)) }
  }

  const y0 = Number(today.slice(0, 4))
  const years = useMemo(() => Array.from({ length: 4 }, (_, i) => `${y0 - 1 + i}年`), [y0])
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${i + 1}月`), [])
  const dy = Number(d.slice(0, 4))
  const dm = Number(d.slice(5, 7))
  const dd = Number(d.slice(8))
  const mdays = useMemo(() => Array.from({ length: daysInMonth(dy, dm) }, (_, i) => `${i + 1}日`), [dy, dm])
  const setYmd = (y: number, mo: number, day: number) => pick(ymd(y, mo, Math.min(day, daysInMonth(y, mo))))
  const cells = useMemo(() => calendarCells(month), [month])
  /* 选中日的主题色圆按行列定位、在格子间滑动；不用 layoutId，卡片推入时不会被量到半路的位置 */
  const selIdx = ymOf(d) === month ? cells.indexOf(d) : -1

  /* 月历与年月日滚轮两层常驻且常驻合成层（will-change），切换只走 CSS 透明度过渡；
     不挂载/卸载子树、不在动画起止建/拆层，Android WebView 不会在起止各闪一帧 */
  const cal = view === 'cal'
  return (
    <div className="relative" style={{ height: CAL_H }}>
      <div className={SWAP_LAYER} style={{ opacity: cal ? 1 : 0, pointerEvents: cal ? 'auto' : 'none' }} aria-hidden={!cal}>
        <div className="flex h-10 items-center justify-between">
          <button onClick={() => goMonth(-1)} className="flex h-10 w-10 items-center justify-center transition-opacity active:opacity-50"><Chevron dir={-1} /></button>
          <button onClick={() => setView('ym')} className="flex items-center gap-1 text-[15px] font-bold text-(--c-ink) transition-opacity active:opacity-50">
            {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
            <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--c-ink3)"><path d="M6 9h12l-6 7z" /></svg>
          </button>
          <button onClick={() => goMonth(1)} className="flex h-10 w-10 items-center justify-center transition-opacity active:opacity-50"><Chevron dir={1} /></button>
        </div>
        <div className="grid h-[26px] grid-cols-7 items-center">
          {WD_SHORT.slice(1).map((w) => <span key={w} className="text-center text-[12px] font-semibold text-(--c-ink4)">{w}</span>)}
        </div>
        <div className="relative" style={{ height: CAL_ROW * 6 }}>
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={month}
              custom={dir}
              variants={{
                enter: (n: number) => ({ opacity: 0, transform: `translateX(${n * 18}px)` }),
                show: { opacity: 1, transform: 'translateX(0px)' },
                exit: (n: number) => ({ opacity: 0, transform: `translateX(${-n * 18}px)` }),
              }}
              initial="enter"
              animate="show"
              exit="exit"
              transition={SHEET}
              className="absolute inset-0 grid grid-cols-7"
            >
              {selIdx >= 0 && (
                <motion.span
                  initial={false}
                  animate={{ left: `${((selIdx % 7) + 0.5) * (100 / 7)}%`, top: (Math.floor(selIdx / 7) + 0.5) * CAL_ROW }}
                  transition={SHEET}
                  className="pointer-events-none absolute -mt-[17px] -ml-[17px] h-[34px] w-[34px] rounded-full bg-(--c-accent)"
                />
              )}
              {cells.map((c) => {
                const inMonth = ymOf(c) === month
                const sel = c === d && inMonth
                const isToday = c === today
                return (
                  <button key={c} onClick={() => pick(c)} className="relative flex items-center justify-center" style={{ height: CAL_ROW }}>
                    <span className={`relative text-[15px] tabular-nums ${sel ? 'font-bold text-white' : isToday ? 'font-bold text-(--c-accent)' : inMonth ? 'font-medium text-(--c-ink)' : 'font-medium text-(--c-ink5)'}`}>
                      {Number(c.slice(8))}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className={`${SWAP_LAYER} flex flex-col`} style={{ opacity: cal ? 0 : 1, pointerEvents: cal ? 'none' : 'auto' }} aria-hidden={cal}>
        <button onClick={() => setView('cal')} className="flex h-10 flex-none items-center justify-center gap-1 text-[15px] font-bold text-(--c-accent) transition-opacity active:opacity-50">
          {dy}年{dm}月
          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--c-accent)"><path d="M6 15h12l-6-7z" /></svg>
        </button>
        <div className="flex flex-1 items-center gap-2">
          <Wheel items={years} index={Math.max(0, Math.min(years.length - 1, dy - (y0 - 1)))} onChange={(i) => setYmd(y0 - 1 + i, dm, dd)} className="flex-1" />
          <Wheel items={months} index={dm - 1} onChange={(i) => setYmd(dy, i + 1, dd)} className="flex-1" />
          <Wheel items={mdays} index={Math.min(dd, mdays.length) - 1} onChange={(i) => setYmd(dy, dm, i + 1)} className="flex-1" />
        </div>
      </div>
    </div>
  )
}

/** 时:分两列滚轮；minutes 为从 0:00 起的分钟数 */
export function TimeWheels({ minutes, onChange, step = 5, className = '' }: { minutes: number; onChange: (m: number) => void; step?: number; className?: string }) {
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => pad2(i)), [])
  const mins = useMemo(() => Array.from({ length: 60 / step }, (_, i) => pad2(i * step)), [step])
  const hi = Math.floor(minutes / 60)
  const mi = Math.round((minutes % 60) / step) % (60 / step)
  return (
    <div className={`flex items-center gap-2 px-10 ${className}`}>
      <Wheel items={hours} index={hi} onChange={(i) => onChange(i * 60 + mi * step)} className="flex-1" />
      <span className="text-[18px] font-bold text-(--c-ink3)">:</span>
      <Wheel items={mins} index={mi} onChange={(i) => onChange(hi * 60 + i * step)} className="flex-1" />
    </div>
  )
}

export function DateSheet({ value, title = '日期', onPick, onClose }: { value: string; title?: string; onPick: (d: string) => void; onClose: () => void }) {
  const dismiss = useRef<(() => void) | null>(null)
  const [d, setD] = useState(value || todayYmd())
  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-5 pb-1"
      header={<SheetHead title={title} sub={`${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 ${WD[weekdayOf(d)]}`} trail={<SheetClose onClick={() => dismiss.current?.()} />} />}
      footer={<div className="px-5 pt-2"><PrimaryButton onClick={() => { onPick(d); dismiss.current?.() }}>确定</PrimaryButton></div>}
    >
      <Calendar value={d} onChange={setD} />
    </Sheet>
  )
}

/** value / onPick 用 "HH:MM" */
export function TimeSheet({ value, title = '时间', step = 1, onPick, onClose }: { value: string; title?: string; step?: number; onPick: (v: string) => void; onClose: () => void }) {
  const dismiss = useRef<(() => void) | null>(null)
  const parse = (v: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60 }
  const [m, setM] = useState(parse(value))
  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-5 pb-1"
      header={<SheetHead title={title} sub={`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`} trail={<SheetClose onClick={() => dismiss.current?.()} />} />}
      footer={<div className="px-5 pt-2"><PrimaryButton onClick={() => { onPick(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`); dismiss.current?.() }}>确定</PrimaryButton></div>}
    >
      <TimeWheels minutes={m} onChange={setM} step={step} className="py-3" />
    </Sheet>
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
  download: <g><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></g>,
  camera: <g><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-2h5.6L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.2" /></g>,
  calendar: <g><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></g>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  flag: <path d="M5 21V4.5M5 4.5h11l-1.5 4L18 12.5H5" />,
  note: <g><rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></g>,
  hourglass: <g><path d="M7 3.5h10M7 20.5h10" /><path d="M8 3.5v3.2c0 2 4 3.8 4 5.3s-4 3.3-4 5.3v3.2M16 3.5v3.2c0 2-4 3.8-4 5.3s4 3.3 4 5.3v3.2" /></g>,
  sun: <g><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></g>,
  book: <g><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 16.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z" /></g>,
}
