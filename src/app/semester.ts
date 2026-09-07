import type { Semester, TimeSlot } from '../domain/types'
import { addDays, fromDate, weekdayOf } from '../domain/dates'
import { uid } from '../domain/store'

const SLOTS = [
  [480, 525], [535, 580], [600, 645], [655, 700],
  [840, 885], [895, 940], [960, 1005], [1015, 1060],
  [1140, 1185], [1195, 1240],
]

/** 按开学月份给学期起名：8 月起上学期，2 月起下学期 */
export function guessSemesterName(startDate: string): string {
  const y = Number(startDate.slice(0, 4))
  const m = Number(startDate.slice(5, 7))
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '当前学期'
  if (m >= 8) return `${y}–${y + 1} 学年 第 1 学期`
  if (m >= 2) return `${y - 1}–${y} 学年 第 2 学期`
  return `${y - 1}–${y} 学年 第 1 学期`
}

/** 学期最后一天（最后一周周日） */
export function termEnd(sem: Pick<Semester, 'startDate' | 'totalWeeks'>): string {
  return addDays(sem.startDate, sem.totalWeeks * 7 - 1)
}

export function semesterEnded(sem: Pick<Semester, 'startDate' | 'totalWeeks'>, today = todayStr()): boolean {
  return today > termEnd(sem)
}

export function defaultSemester(startDate: string): Semester {
  return {
    id: uid(),
    name: guessSemesterName(startDate),
    startDate,
    totalWeeks: 20,
    timeGrid: SLOTS.map(([s, e], i) => ({ index: i + 1, start: s, end: e })),
    vacations: [],
    examWeeks: [],
  }
}

/** 节次表还是出厂默认（用户没在「作息时间」改过、也没被导入改过） */
export function isDefaultGrid(grid: TimeSlot[]): boolean {
  return grid.length === SLOTS.length && grid.every((t, i) => t.start === SLOTS[i][0] && t.end === SLOTS[i][1])
}

/** 课程节次超出节次表时，按最后一节的时长和 10 分课间往后补 */
export function extendGrid(grid: TimeSlot[], need: number): TimeSlot[] {
  if (need <= grid.length) return grid
  const out = [...grid]
  while (out.length < need) {
    const last = out[out.length - 1]
    const dur = last ? last.end - last.start : 45
    const start = last ? last.end + 10 : 8 * 60
    out.push({ index: out.length + 1, start, end: start + dur })
  }
  return out
}

export const todayStr = (): string => fromDate(new Date())

export function mondayOf(d: string): string {
  return addDays(d, 1 - weekdayOf(d))
}

export function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
