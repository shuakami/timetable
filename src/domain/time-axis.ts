import type { Minutes, TimeSlot } from './types'

/**
 * 周视图的纵轴：按节次分段的分段线性时间轴。
 * 每节一行，行高按这一行里卡片实际需要的高度来（见 rowHeights），课间压成窄带，长课间（午休、晚饭）压成一条带标签的分隔带；
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

/** 行高上限：两行课名 + 两行地点 */
export const AXIS_ROW = 60
/** 行高下限：空行、连堂课的后半节；左侧序号 + 时刻刚好放下 */
export const AXIS_ROW_MIN = 32
export const AXIS_GAP = 6
export const AXIS_WIDE_GAP = 30
/** 卡片相对节次边界的内缩：相邻两节连排时上下各留这么多 */
export const CARD_INSET = 1.5
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

export function buildAxis(grid: TimeSlot[], span?: { start: Minutes; end: Minutes }, rows?: Map<number, number>): TimeAxis {
  const slots = [...grid].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const rowH = (index: number) => (rows ? Math.min(AXIS_ROW, Math.max(AXIS_ROW_MIN, Math.ceil(rows.get(index) ?? 0))) : AXIS_ROW)
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
        push({ kind: 'period', t0, t1: s.end, y0: y, y1: y + rowH(s.index), index: s.index })
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
 * 卡片按自身高度和宽度决定课名、地点各排几行：先保课名，再保地点，两者都按可用宽度折行而不是一刀截断。
 * 行高：课名 9.5px/1.3 = 12.35，地点 8.5px/1.25 = 10.625；地点上方 2px；内边距上下各 4（dense 为 2）。
 * 一节课（60 - 3 内缩）恰好放下两行课名 + 两行地点。
 */
export interface CardFit {
  nameLines: number
  locLines: number
  dense: boolean
}

export const CARD_LINE = 12.35
export const CARD_LOC_LINE = 10.625
export const CARD_LOC_GAP = 2
export const CARD_PAD = 4
export const CARD_PAD_DENSE = 2
export const CARD_PAD_X = 4
export const CARD_NAME_PX = 9.5
export const CARD_LOC_PX = 8.5

/** 粗估单字宽度（em，按粗体偏宽估）：全角 1，大写 0.72，数字 0.64，小写 0.58，空格 0.3，其余 ASCII 0.6 */
function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if (c === 0x20) return 0.3
  if (c < 0x80) return /[A-Z]/.test(ch) ? 0.72 : /[0-9]/.test(ch) ? 0.64 : /[a-z]/.test(ch) ? 0.58 : 0.6
  return 1
}

export function textWidth(s: string, px: number): number {
  let w = 0
  for (const ch of s) w += charEm(ch)
  return w * px
}

/** 折行单位：全角字逐字，英数连续段整体，空格单独一项 */
function tokens(s: string): string[] {
  return s.match(/\s+|[^\s\u0080-\uffff]+|./gu) ?? []
}

/** 按 overflow-wrap:anywhere 贪心折行后的行数：优先在空格/全角字之间换行，英数段放不下整行时才拆字 */
function linesFor(s: string, px: number, w: number): number {
  if (!s) return 0
  const max = Math.max(1, w)
  let lines = 1
  let cur = 0
  let space = 0
  for (const t of tokens(s)) {
    if (/^\s+$/.test(t)) {
      if (cur > 0) space = textWidth(t, px)
      continue
    }
    const tw = textWidth(t, px)
    if (cur > 0 && cur + space + tw > max) {
      lines++
      cur = 0
    } else cur += space
    space = 0
    if (tw > max) {
      for (const ch of t) {
        const cw = charEm(ch) * px
        if (cur > 0 && cur + cw > max) {
          lines++
          cur = 0
        }
        cur += cw
      }
    } else cur += tw
  }
  return lines
}

/** 一行摆不下两个字的窄卡里空格只会白占一行，直接去掉 */
function locBase(loc: string, aw: number): string {
  return aw < CARD_LOC_PX * 2 ? loc.replace(/\s+/g, '') : loc
}

/**
 * 地点排不下时先去掉空格再试；仍排不下就从头部截掉、保留尾部的楼层房号（「第二教学楼 B-301」→「…学楼B-301」），
 * 而不是让排版从尾部省略掉最有用的房号。
 */
export function fitLoc(loc: string, lines: number, w: number): string {
  const aw = w - CARD_PAD_X * 2
  const tight = loc.replace(/\s+/g, '')
  const base = locBase(loc, aw)
  if (lines < 1 || linesFor(base, CARD_LOC_PX, aw) <= lines) return base
  if (linesFor(tight, CARD_LOC_PX, aw) <= lines) return tight
  const chars = [...tight]
  let i = chars.length
  while (i > 1 && linesFor('…' + chars.slice(i - 1).join(''), CARD_LOC_PX, aw) <= lines) i--
  return '…' + chars.slice(i).join('')
}

/** 一张卡想完整显示需要的高度（含上下内缩）：课名最多两行，地点最多两行 */
export function cardNeed(w: number, name: string, loc?: string): number {
  const aw = w - CARD_PAD_X * 2
  const nameLines = Math.min(2, linesFor(name, CARD_NAME_PX, aw))
  const locLines = loc ? Math.min(2, linesFor(locBase(loc, aw), CARD_LOC_PX, aw)) : 0
  return CARD_PAD * 2 + nameLines * CARD_LINE + (locLines > 0 ? CARD_LOC_GAP + locLines * CARD_LOC_LINE : 0) + CARD_INSET * 2
}

/**
 * 每节的行高需求：取覆盖这一节的卡片里最高的需求；跨多节的课把需求（扣掉中间的课间）平摊到各节，
 * 所以连堂课的后半节不会被擑高。结果交给 buildAxis，在那里夹到 [AXIS_ROW_MIN, AXIS_ROW]。
 */
export function rowHeights(grid: TimeSlot[], cards: { start: Minutes; end: Minutes; name: string; loc?: string }[], w: number): Map<number, number> {
  const rows = new Map<number, number>()
  for (const c of cards) {
    const covered = grid.filter((s) => s.start < c.end && c.start < s.end)
    if (covered.length === 0) continue
    const per = (cardNeed(w, c.name, c.loc) - AXIS_GAP * (covered.length - 1)) / covered.length
    for (const s of covered) rows.set(s.index, Math.max(rows.get(s.index) ?? 0, per))
  }
  return rows
}

export function cardFit(h: number, w: number, name: string, loc?: string): CardFit | null {
  const aw = w - CARD_PAD_X * 2
  const needName = linesFor(name, CARD_NAME_PX, aw)
  const needLoc = loc ? linesFor(locBase(loc, aw), CARD_LOC_PX, aw) : 0

  if (h < 17) return null
  if (h < 26) return { nameLines: 1, locLines: 0, dense: true }
  const budget = h - CARD_PAD * 2
  const maxName = Math.floor(budget / CARD_LINE)
  if (maxName < 1) return { nameLines: 1, locLines: 0, dense: true }
  /* 有地点时先给地点留够位（最多两行），课名用剩下的；连一行地点都留不出时课名至少一行 */
  const locWant = Math.min(needLoc, 2)
  const nameCap = needLoc > 0 ? Math.max(1, Math.floor((budget - CARD_LOC_GAP - locWant * CARD_LOC_LINE) / CARD_LINE)) : maxName
  const nameLines = Math.min(needName, nameCap)
  const rest = budget - nameLines * CARD_LINE - CARD_LOC_GAP
  const locLines = needLoc > 0 ? Math.min(needLoc, Math.max(0, Math.floor(rest / CARD_LOC_LINE))) : 0
  return { nameLines, locLines, dense: false }
}
