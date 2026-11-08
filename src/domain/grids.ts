import type { LocalDate, ScheduleGrid, Semester, TimeSlot } from './types'
import { weekOf } from './dates'

/* 多作息制：Semester.timeGrid 是默认节次表，grids 里每套带自己的周次区间。
   解析规则：按数组顺序找第一套覆盖该周的作息制，都没有就用默认表。
   区间按周次对齐——一周只属于一套作息，周视图的纵轴因此不会跨表。 */

/** 第 week 周用哪套节次表 */
export function gridForWeek(sem: Semester, week: number): TimeSlot[] {
  const g = sem.grids?.find((x) => week >= x.fromWeek && week <= x.toWeek)
  return g?.timeGrid ?? sem.timeGrid
}

/** 某天用哪套节次表（按它所在学期周次解析；学期外回落默认表） */
export function gridForDate(sem: Semester, date: LocalDate): TimeSlot[] {
  return gridForWeek(sem, weekOf(sem, date))
}

/** 全部节次表里最多的节数：导入校验、节次选择器用 */
export function maxPeriods(sem: Semester): number {
  let n = sem.timeGrid.length
  for (const g of sem.grids ?? []) n = Math.max(n, g.timeGrid.length)
  return n
}

const okSlot = (t: unknown): t is TimeSlot => {
  const o = t as TimeSlot
  return !!o && typeof o.index === 'number' && typeof o.start === 'number' && typeof o.end === 'number' && o.end > o.start
}

/**
 * 清洗持久化 / 导入带进来的作息制列表：丢掉没有有效节次表、周次缺失的条目，
 * 周次钳到 [1, totalWeeks] 并保证 from <= to，缺 id 的补稳定 id。
 * 没有可用项返回 undefined（调用方据此删除 grids 字段）。
 */
export function sanitizeGrids(raw: unknown, totalWeeks: number): ScheduleGrid[] | undefined {
  if (!Array.isArray(raw) || !(totalWeeks >= 1)) return undefined
  const out: ScheduleGrid[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const o = x as Partial<ScheduleGrid> | null
    if (!o || typeof o !== 'object') continue
    const slots = (Array.isArray(o.timeGrid) ? o.timeGrid : []).filter(okSlot).sort((a, b) => a.index - b.index)
    if (slots.length === 0) continue
    let f = Math.round(Number(o.fromWeek))
    let t = Math.round(Number(o.toWeek))
    if (!Number.isFinite(f) || !Number.isFinite(t)) continue
    f = Math.min(Math.max(f, 1), totalWeeks)
    t = Math.min(Math.max(t, 1), totalWeeks)
    if (f > t) [f, t] = [t, f]
    let id = typeof o.id === 'string' && o.id ? o.id : ''
    if (!id || seen.has(id)) {
      let n = out.length + 1
      while (seen.has(`grid-${n}`)) n++
      id = `grid-${n}`
    }
    seen.add(id)
    out.push({ id, name: typeof o.name === 'string' ? o.name : '', fromWeek: f, toWeek: t, timeGrid: slots })
  }
  return out.length > 0 ? out : undefined
}

/** 新作息制的默认生效区间：第一段还没被其他作息制占用的周次；全占满时给整个学期 */
export function defaultGridRange(sem: Semester): [number, number] {
  const total = Math.max(1, sem.totalWeeks)
  const covered = (w: number) => (sem.grids ?? []).some((g) => w >= g.fromWeek && w <= g.toWeek)
  for (let w = 1; w <= total; w++) {
    if (covered(w)) continue
    let e = w
    while (e + 1 <= total && !covered(e + 1)) e++
    return [w, e]
  }
  return [1, total]
}
