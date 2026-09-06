import React from 'react'
import { cardFit, type TimeAxis } from '../domain/time-axis'
import { fmtMinutes } from '../domain/dates'
import { tint } from './ui'

/** 周视图卡片：按自身高度决定放课名几行、要不要地点 */
export function WeekCard({ name, loc, color, h, now, done, progress, half, sticker, lineThrough, ring }: {
  name: string
  loc?: string
  color: string
  h: number
  now?: boolean
  done?: boolean
  progress?: number
  half?: boolean
  sticker?: string | null
  lineThrough?: boolean
  ring?: string
}) {
  const fit = cardFit(h, half)
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[9px] text-left font-bold ${fit?.dense || half ? 'px-1 py-0.5' : 'px-1 py-1.5'} ${lineThrough ? 'line-through' : ''}`}
      style={{
        background: tint(color, now ? 22 : done ? 7 : 10),
        color: `color-mix(in srgb, ${color} 85%, var(--c-ink-mix))`,
        boxShadow: ring ?? (now ? `inset 0 0 0 1.5px ${color}` : undefined),
      }}
    >
      {fit && (
        <div
          className={`text-[9.5px] leading-[1.35] ${fit.lines > 1 ? 'overflow-hidden' : 'truncate'} ${half ? 'break-all' : ''}`}
          style={fit.lines > 1 ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: fit.lines } : undefined}
        >
          {name}
        </div>
      )}
      {fit?.loc && loc && <div className={`mt-0.5 truncate text-[8.5px] leading-[1.3] font-semibold opacity-60 ${sticker ? 'pr-2.5' : ''}`}>{loc}</div>}
      {now && progress != null && <div className="pointer-events-none absolute inset-x-0 top-0 bg-(--c-surface)/60" style={{ height: progress }} />}
    </div>
  )
}

/** 左侧节次刻度：序号 + 开始时刻；当前时刻不与刻度打架时单独标出 */
export function WeekAxis({ axis, nowTop, nowLabel }: { axis: TimeAxis; nowTop?: number; nowLabel?: string }) {
  const periods = axis.segs.filter((s) => s.kind === 'period')
  return (
    <div className="relative w-8 flex-none" style={{ height: axis.height }}>
      {periods.map((s) => (
        <div key={s.index} className="absolute right-1.5 left-0 text-right" style={{ top: s.y0 + 4 }}>
          <div className="text-[10.5px] leading-none font-bold tabular-nums text-(--c-ink4)">{s.index}</div>
          <div className="mt-[3px] text-[8.5px] leading-none font-semibold tabular-nums text-(--c-ink5)">{fmtMinutes(s.t0).replace(/^0/, '')}</div>
        </div>
      ))}
      {nowTop != null && nowLabel && periods.every((s) => Math.abs(nowTop - s.y0) >= 22) && (
        <div className="absolute right-1.5 text-[9.5px] font-bold tabular-nums text-(--c-accent)" style={{ top: nowTop - 6 }}>{nowLabel}</div>
      )}
    </div>
  )
}

/** 每节顶部一条横线；长课间画成带说明的虚线分隔带 */
export function WeekLines({ axis }: { axis: TimeAxis }) {
  return (
    <>
      {axis.segs.map((s, i) => (
        <React.Fragment key={i}>
          {s.kind === 'period' && <div className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: s.y0 + 6 }} />}
          {s.kind === 'gap' && s.label && (
            <div className="absolute right-0 left-8 flex items-center" style={{ top: s.y0 + 6, height: s.y1 - s.y0 }}>
              <span className="flex-1 border-t border-dashed border-(--c-line)" />
              <span className="px-2 text-[9px] font-semibold tabular-nums text-(--c-ink5)">{s.label}</span>
              <span className="flex-1 border-t border-dashed border-(--c-line)" />
            </div>
          )}
        </React.Fragment>
      ))}
    </>
  )
}
