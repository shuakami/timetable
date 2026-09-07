import React from 'react'
import { cardFit, fitLoc, type TimeAxis } from '../domain/time-axis'
import { fmtMinutes } from '../domain/dates'
import { tint } from './ui'

function clampStyle(lines: number): React.CSSProperties | undefined {
  return lines > 1 ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines } : undefined
}

export type WeekCardStatus = 'normal' | 'moved' | 'cancelled' | 'leave' | 'done'

/**
 * 周视图卡片：按自身高宽决定课名、地点各排几行。
 * 冲突时后一张卡叠在前一张下面右移 5px 露出一条边（原型做法）；textTop 是它被盖住的高度，文字从露出的部分开始排。
 * 状态只用底纹表达，不压文字：停课 = 空心虚线框 + 划掉；请假 = 斜纹底；调课 = 点阵底；静音 = 浅底 + 淡字。
 */
export function WeekCard({ name, loc, color, h, w, now, done, progress, sticker, status = 'normal', muted, ring, textTop = 0, tone }: {
  name: string
  loc?: string
  color: string
  h: number
  w: number
  now?: boolean
  done?: boolean
  progress?: number
  sticker?: string | null
  status?: WeekCardStatus
  muted?: boolean
  ring?: string
  textTop?: number
  tone?: number
}) {
  const fit = cardFit(h - textTop, w, name, loc)
  const lineCls = (n: number) => (n > 1 ? 'overflow-hidden wrap-anywhere' : 'truncate')
  const cancelled = status === 'cancelled'
  const fill = tint(color, tone ?? (now ? 22 : done ? 7 : muted ? 5 : 10))
  const background = cancelled
    ? 'transparent'
    : status === 'leave'
      ? `repeating-linear-gradient(135deg, ${fill} 0 4px, transparent 4px 8px)`
      : status === 'moved'
        ? `radial-gradient(${fill} 1.6px, transparent 1.8px) 0 0 / 6px 6px, ${tint(color, 4)}`
        : fill
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[9px] text-left font-bold ${fit?.dense ? 'px-1 py-0.5' : 'px-1 py-1'} ${cancelled ? 'line-through' : ''}`}
      style={{
        background,
        color: `color-mix(in srgb, ${color} ${cancelled || muted ? 60 : 85}%, var(--c-ink-mix))`,
        boxShadow: ring ?? (now ? `inset 0 0 0 1.5px ${color}` : undefined),
        outline: cancelled ? `1.5px dashed color-mix(in srgb, ${color} 55%, transparent)` : undefined,
        outlineOffset: cancelled ? -1.5 : undefined,
        paddingTop: textTop > 0 ? textTop + (fit?.dense ? 2 : 4) : undefined,
      }}
    >
      {fit && (
        <div className={`relative text-[9.5px] leading-[1.3] ${lineCls(fit.nameLines)}`} style={clampStyle(fit.nameLines)}>
          {name}
        </div>
      )}
      {fit && fit.locLines > 0 && loc && (
        <div
          className={`relative mt-0.5 text-[8.5px] leading-[1.25] font-semibold opacity-60 ${lineCls(fit.locLines)} ${sticker && fit.locLines === 1 ? 'pr-2.5' : ''}`}
          style={clampStyle(fit.locLines)}
        >
          {fitLoc(loc, fit.locLines, sticker && fit.locLines === 1 ? w - 10 : w)}
        </div>
      )}
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

/**
 * 网格线：节与节之间一条横线，落在课间正中；长课间（午休/晚饭）的那条线从中间断开写上说明，
 * 仍是一条线，不另起一套带子。
 */
export function WeekLines({ axis }: { axis: TimeAxis }) {
  return (
    <>
      {axis.segs.map((s, i) => {
        const prev = axis.segs[i - 1]
        if (s.kind === 'period') {
          if (prev?.kind === 'gap' && prev.label) return null
          const y = prev?.kind === 'gap' ? (prev.y0 + prev.y1) / 2 : s.y0
          return <div key={i} className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: y + 6 }} />
        }
        if (s.kind === 'gap' && s.label) {
          return (
            <div
              key={i}
              className="absolute right-0 left-8 flex items-center gap-2 text-[9px] leading-none font-semibold tabular-nums text-(--c-ink4)"
              style={{ top: s.y0 + 6, height: s.y1 - s.y0 }}
            >
              <i className="h-px flex-1 bg-(--c-line2)" />
              <span>{s.label}</span>
              <i className="h-px flex-1 bg-(--c-line2)" />
            </div>
          )
        }
        return null
      })}
    </>
  )
}
