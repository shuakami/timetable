import type { LocalDate, Minutes, Semester } from './types'

/* 本地日期工具：全部基于 'YYYY-MM-DD' 字符串与本地历法，不引入时区。 */

export function toDate(d: LocalDate): Date {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd)
}

export function fromDate(d: Date): LocalDate {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const x = toDate(d)
  x.setDate(x.getDate() + n)
  return fromDate(x)
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000)
}

/** 周一=1 … 周日=7 */
export function weekdayOf(d: LocalDate): number {
  const w = toDate(d).getDay()
  return w === 0 ? 7 : w
}

/** 学期第几周；<1 学期前，>totalWeeks 学期后 */
export function weekOf(sem: Semester, d: LocalDate): number {
  return Math.floor(diffDays(d, sem.startDate) / 7) + 1
}

/** 第 week 周 weekday（周一=1）对应日期 */
export function dateOf(sem: Semester, week: number, weekday: number): LocalDate {
  return addDays(sem.startDate, (week - 1) * 7 + (weekday - 1))
}

export function inVacation(sem: Semester, d: LocalDate): string | null {
  for (const v of sem.vacations) if (d >= v.start && d <= v.end) return v.name
  return null
}

/** 时长：45 → 「45 分钟」，90 → 「1 小时 30 分钟」，120 → 「2 小时」 */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} 分钟`
  if (r === 0) return `${h} 小时`
  return `${h} 小时 ${r} 分钟`
}

export function fmtMinutes(min: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`
}

/** 某一天某时刻（从 00:00 起的分钟数）的 epoch ms */
export function atMinutes(date: LocalDate, min: Minutes): number {
  const d = toDate(date)
  d.setMinutes(min)
  return d.getTime()
}
