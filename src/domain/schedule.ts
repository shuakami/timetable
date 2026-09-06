import type { Minutes, TimeSlot } from './types'

/*
 * 作息时间的编辑模型：每节只记开始时刻，下课 = 开始 + 标准时长；某节下课不同就单独记一个覆盖值。
 * 与 Semester.timeGrid 双向转换，timeGrid 仍是运行时唯一真相。
 */

export const DEFAULT_DURATION = 45
export const DEFAULT_BREAK = 10
export const MIN_DURATION = 20
export const MAX_DURATION = 120
export const MIN_PERIODS = 4
export const MAX_PERIODS = 20
export const DURATION_STEP = 5

export interface ScheduleDraft {
  starts: Minutes[]
  duration: Minutes
  /** 与 starts 对齐；非 null 表示这节下课时刻单独改过 */
  ends: (Minutes | null)[]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 出现次数最多的课长作为标准时长；平局取较短的 */
export function inferDuration(grid: TimeSlot[]): Minutes {
  const count = new Map<number, number>()
  for (const s of grid) {
    const d = s.end - s.start
    if (d > 0) count.set(d, (count.get(d) ?? 0) + 1)
  }
  let best = DEFAULT_DURATION
  let n = 0
  for (const [d, c] of [...count.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > n) {
      best = d
      n = c
    }
  }
  return best
}

export function draftFromGrid(grid: TimeSlot[]): ScheduleDraft {
  const slots = [...grid].sort((a, b) => a.index - b.index)
  const duration = inferDuration(slots)
  return {
    starts: slots.map((s) => s.start),
    duration,
    ends: slots.map((s) => (s.end - s.start === duration ? null : s.end)),
  }
}

export function endOf(d: ScheduleDraft, i: number): Minutes {
  return d.ends[i] ?? d.starts[i] + d.duration
}

export function gridFromDraft(d: ScheduleDraft): TimeSlot[] {
  return d.starts.map((start, i) => ({ index: i + 1, start, end: endOf(d, i) }))
}

/** 增减总节数：加在末尾，沿用上一段课间（没有就 10 分钟）；减掉末尾 */
export function setCount(d: ScheduleDraft, n: number): ScheduleDraft {
  n = clamp(Math.round(n), MIN_PERIODS, MAX_PERIODS)
  if (n === d.starts.length) return d
  if (n < d.starts.length) return { ...d, starts: d.starts.slice(0, n), ends: d.ends.slice(0, n) }
  const starts = [...d.starts]
  const ends = [...d.ends]
  while (starts.length < n) {
    const k = starts.length
    const lastEnd = k > 0 ? (ends[k - 1] ?? starts[k - 1] + d.duration) : 8 * 60 - d.duration - DEFAULT_BREAK
    const gap = k >= 2 ? Math.min(30, Math.max(0, starts[k - 1] - (ends[k - 2] ?? starts[k - 2] + d.duration))) : DEFAULT_BREAK
    starts.push(Math.min(24 * 60 - d.duration, lastEnd + gap))
    ends.push(null)
  }
  return { ...d, starts, ends }
}

/** 改标准时长：没单独改过下课的节次自动跟着变；改过的保持不动 */
export function setDuration(d: ScheduleDraft, duration: Minutes): ScheduleDraft {
  duration = clamp(Math.round(duration / DURATION_STEP) * DURATION_STEP, MIN_DURATION, MAX_DURATION)
  if (duration === d.duration) return d
  /* 之前的覆盖值若恰好等于新时长，就不再算「单独改过」 */
  const ends = d.ends.map((e, i) => (e != null && e - d.starts[i] === duration ? null : e))
  return { ...d, duration, ends }
}

/**
 * 改某节开始。shiftLater 时之后的节次整体平移同样的分钟数（保持课间不变）；
 * 否则只动这一节，单独改过的下课时刻跟着平移，保证时长不变。
 */
export function setStart(d: ScheduleDraft, i: number, start: Minutes, shiftLater: boolean): ScheduleDraft {
  start = clamp(Math.round(start), 0, 24 * 60 - 1)
  const delta = start - d.starts[i]
  if (delta === 0) return d
  const starts = [...d.starts]
  const ends = [...d.ends]
  const last = shiftLater ? starts.length - 1 : i
  for (let k = i; k <= last; k++) {
    starts[k] = clamp(starts[k] + delta, 0, 24 * 60 - 1)
    if (ends[k] != null) ends[k] = clamp(ends[k]! + delta, starts[k] + 1, 24 * 60)
  }
  return { ...d, starts, ends }
}

/** 单独改某节下课；等于标准时长就回到自动 */
export function setEnd(d: ScheduleDraft, i: number, end: Minutes): ScheduleDraft {
  end = clamp(Math.round(end), d.starts[i] + 1, 24 * 60)
  const ends = [...d.ends]
  ends[i] = end - d.starts[i] === d.duration ? null : end
  return { ...d, ends }
}

export function resetEnd(d: ScheduleDraft, i: number): ScheduleDraft {
  if (d.ends[i] == null) return d
  const ends = [...d.ends]
  ends[i] = null
  return { ...d, ends }
}

/** 相邻节次的间隔；第 0 节为 0 */
export function breakBefore(d: ScheduleDraft, i: number): Minutes {
  return i === 0 ? 0 : d.starts[i] - endOf(d, i - 1)
}

/** 重叠 / 倒序的节次序号（从 0 起），用于标红 */
export function invalidPeriods(d: ScheduleDraft): number[] {
  const bad: number[] = []
  for (let i = 0; i < d.starts.length; i++) {
    if (endOf(d, i) <= d.starts[i]) bad.push(i)
    else if (i > 0 && d.starts[i] < endOf(d, i - 1)) bad.push(i)
  }
  return bad
}

/* 午休 / 晚饭的截止：下一节若会拖过截止就跳到 14:00 / 19:00。先按紧的排，排不下（拖过 23:00）再放宽 */
const DAY_PLANS: [Minutes, Minutes][] = [
  [12 * 60, 18 * 60],
  [12 * 60 + 30, 18 * 60 + 30],
  [Infinity, Infinity],
]

/** 引导用：三个数生成整天作息，课间固定 10 分钟 */
export function generateGrid(count: number, duration: Minutes, first: Minutes, gap: Minutes = DEFAULT_BREAK): TimeSlot[] {
  count = clamp(Math.round(count), MIN_PERIODS, MAX_PERIODS)
  duration = clamp(duration, MIN_DURATION, MAX_DURATION)
  first = clamp(first, 0, 24 * 60 - duration)
  let out: TimeSlot[] = []
  for (const [noon, dusk] of DAY_PLANS) {
    out = []
    let s = first
    for (let i = 0; i < count; i++) {
      const e = Math.min(24 * 60, s + duration)
      out.push({ index: i + 1, start: s, end: e })
      let next = e + gap
      if (next < 14 * 60 && next + duration > noon) next = 14 * 60
      else if (next >= 14 * 60 && next < 19 * 60 && next + duration > dusk) next = 19 * 60
      s = Math.min(24 * 60 - duration, next)
    }
    if (out[out.length - 1].end <= 23 * 60) break
  }
  return out
}
