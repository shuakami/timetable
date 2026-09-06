import type { Minutes, TimeSlot } from './types'

/**
 * 周视图的纵轴：按节次分段的分段线性时间轴。
 * 每节固定一行高度（课名、地点总能放下），课间压成窄带，长课间（午休、晚饭）压成一条带标签的分隔带；
 * 落在节次之外的时间（早课、晚自习）按真实时长线性延伸。任意时刻都能映射到唯一纵坐标，卡片高度仍随时长单调增长。
 */
export interface AxisSeg {
  kind: 'period' | 'gap' | 'pad'
  t0: Minutes
  t1: Minutes
  y0: number
  y1: number
  /** period：节次序号 */
  index?: number
  /** gap：长课间的说明，如「午休 2 小时 20 分」 */
  label?: string
}

export interface TimeAxis {
  segs: AxisSeg[]
  height: number
  y(t: Minutes): number
}

export const AXIS_ROW = 56
export const AXIS_GAP = 8
export const AXIS_WIDE_GAP = 26
export const AXIS_PAD_PER_HOUR = 42
/** 达到这个长度的课间单独成带并标注 */
export const AXIS_WIDE_MIN = 45

export function gapLabel(prevEnd: Minutes, gap: Minutes): string {
  const who = prevEnd < 15 * 60 ? '午休' : prevEnd < 20 * 60 ? '晚饭' : '休息'
  const h = Math.floor(gap / 60)
  const m = gap % 60
  const dur = h > 0 ? `${h} 小时${m ? ` ${m} 分` : ''}` : `${m} 分`
  return `${who} ${dur}`
}

function linear(t0: Minutes, t1: Minutes, y0: number, kind: AxisSeg['kind']): AxisSeg {
  return { kind, t0, t1, y0, y1: y0 + ((t1 - t0) / 60) * AXIS_PAD_PER_HOUR }
}

export function buildAxis(grid: TimeSlot[], span?: { start: Minutes; end: Minutes }): TimeAxis {
  const slots = [...grid].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const segs: AxisSeg[] = []
  let y = 0
  const push = (s: AxisSeg) => {
    segs.push(s)
    y = s.y1
  }

  if (slots.length === 0) {
    const t0 = Math.min(8 * 60, span?.start ?? 8 * 60)
    const t1 = Math.max(20 * 60, span?.end ?? 20 * 60)
    push(linear(t0, t1, 0, 'pad'))
  } else {
    if (span && span.start < slots[0].start) push(linear(Math.floor(span.start / 60) * 60, slots[0].start, 0, 'pad'))
    let cursor = slots[0].start
    slots.forEach((s, i) => {
      const t0 = Math.max(s.start, cursor)
      if (i > 0) {
        const gap = t0 - cursor
        if (gap >= AXIS_WIDE_MIN) push({ kind: 'gap', t0: cursor, t1: t0, y0: y, y1: y + AXIS_WIDE_GAP, label: gapLabel(cursor, gap) })
        else if (gap > 0) push({ kind: 'gap', t0: cursor, t1: t0, y0: y, y1: y + AXIS_GAP })
      }
      if (s.end > t0) {
        push({ kind: 'period', t0, t1: s.end, y0: y, y1: y + AXIS_ROW, index: s.index })
        cursor = s.end
      }
    })
    if (span && span.end > cursor) push(linear(cursor, Math.ceil(span.end / 60) * 60, y, 'pad'))
  }

  const first = segs[0]
  const last = segs[segs.length - 1]
  const yOf = (t: Minutes): number => {
    if (t <= first.t0) return first.y0 - ((first.t0 - t) / 60) * AXIS_PAD_PER_HOUR
    if (t >= last.t1) return last.y1 + ((t - last.t1) / 60) * AXIS_PAD_PER_HOUR
    for (const s of segs) {
      if (t >= s.t0 && t <= s.t1) return s.y0 + ((t - s.t0) / (s.t1 - s.t0)) * (s.y1 - s.y0)
    }
    return last.y1
  }
  return { segs, height: y, y: yOf }
}

/**
 * 卡片按自身高度决定放什么：先保课名，再保地点。三档之外只剩色块。
 * 高度阈值来自 9.5px/1.35 的课名行高 12.8、地点块 13、上下内边距 12。
 * narrow（冲突并排的半宽卡）一行摆不下几个字，改成不放地点、课名按高度能排几行排几行。
 */
export type CardFit = { lines: number; loc: boolean; dense: boolean } | null

export const CARD_LINE = 12.8

export function cardFit(h: number, narrow = false): CardFit {
  if (narrow) {
    const lines = Math.floor((h - 8) / CARD_LINE)
    if (lines < 1) return null
    return { lines: Math.min(6, lines), loc: false, dense: lines < 2 }
  }
  if (h >= 52) return { lines: 2, loc: true, dense: false }
  if (h >= 38) return { lines: 1, loc: true, dense: false }
  if (h >= 26) return { lines: 1, loc: false, dense: false }
  if (h >= 17) return { lines: 1, loc: false, dense: true }
  return null
}
