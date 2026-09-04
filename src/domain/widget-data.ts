import type { LocalDate, WidgetStyle } from './types'
import { addDays, dateOf, fmtMinutes, fromDate, weekOf } from './dates'
import { occurrencesOn, type Snapshot } from './engine'
import { atMinutes } from './notify-plan'

/* 桌面小组件的数据快照：JS 只给事实（时间戳、颜色、名字），
   「现在第几节、还剩几节、下一节几分钟后」由原生渲染时算，避免小组件停在旧时间上。 */

export interface WidgetItem {
  name: string
  loc: string
  teacher: string
  color: string
  start: string // HH:MM
  startAt: number
  endAt: number
  cancelled: boolean
}

export interface WidgetDay {
  date: LocalDate
  weekday: number
  week: number
  items: WidgetItem[]
}

export interface WidgetData {
  updatedAt: number
  style: WidgetStyle
  week: number
  totalWeeks: number
  days: WidgetDay[]
}

/** 从今天所在周的周一起 14 天，够今日/明日/周视图三种样式用 */
export function buildWidgetData(snap: Snapshot | null, style: WidgetStyle, now: Date): WidgetData {
  const today = fromDate(now)
  const week = snap ? Math.max(1, Math.min(snap.semester.totalWeeks, weekOf(snap.semester, today))) : 0
  const from = snap ? dateOf(snap.semester, week, 1) : today
  const days: WidgetDay[] = []
  if (snap) {
    for (let i = 0; i < 14; i++) {
      const date = addDays(from, i)
      days.push({
        date,
        weekday: ((new Date(atMinutes(date, 0)).getDay() + 6) % 7) + 1,
        week: weekOf(snap.semester, date),
        items: occurrencesOn(snap, date).map((o) => ({
          name: o.name,
          loc: o.location ?? '',
          teacher: o.teacher ?? '',
          color: o.color,
          start: fmtMinutes(o.start),
          startAt: atMinutes(date, o.start),
          endAt: atMinutes(date, o.end),
          cancelled: o.status === 'cancelled',
        })),
      })
    }
  }

  return {
    updatedAt: now.getTime(),
    style,
    week,
    totalWeeks: snap?.semester.totalWeeks ?? 0,
    days,
  }
}
