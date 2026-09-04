import type { Semester } from '../domain/types'
import { addDays, fromDate, weekdayOf } from '../domain/dates'
import { uid } from '../domain/store'

const SLOTS = [
  [480, 525], [535, 580], [600, 645], [655, 700],
  [840, 885], [895, 940], [960, 1005], [1015, 1060],
  [1140, 1185], [1195, 1240],
]

export function defaultSemester(startDate: string): Semester {
  return {
    id: uid(),
    name: '当前学期',
    startDate,
    totalWeeks: 20,
    timeGrid: SLOTS.map(([s, e], i) => ({ index: i + 1, start: s, end: e })),
    vacations: [],
    examWeeks: [],
  }
}

export const todayStr = () => fromDate(new Date())

export function mondayOf(d: string): string {
  return addDays(d, 1 - weekdayOf(d))
}

export function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
