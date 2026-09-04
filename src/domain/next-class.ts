import type { LocalDate, Minutes, Occurrence } from './types'
import type { Snapshot } from './engine'
import { addDays } from './dates'
import { occurrencesOn } from './engine'

export interface ClassMoment {
  courseId: string
  name: string
  color: string
  date: LocalDate
  start: Minutes
  end: Minutes
}

const toMoment = (o: Occurrence): ClassMoment => ({
  courseId: o.courseId ?? '',
  name: o.name,
  color: o.color,
  date: o.date,
  start: o.start,
  end: o.end,
})

/** 当前正在上的一节；不在课上返回 null */
export function currentClass(snap: Snapshot, date: LocalDate, now: Minutes): ClassMoment | null {
  const hit = occurrencesOn(snap, date).find(
    (o) => o.courseId && o.status !== 'cancelled' && o.start <= now && now < o.end,
  )
  return hit ? toMoment(hit) : null
}

/** 刚结束的一节：结束时间在 [now - within, now) 内，取最近的一节 */
export function justEndedClass(
  snap: Snapshot,
  date: LocalDate,
  now: Minutes,
  within: Minutes = 30,
): ClassMoment | null {
  const done = occurrencesOn(snap, date)
    .filter((o) => o.courseId && o.status !== 'cancelled' && o.end <= now && now - o.end <= within)
    .sort((a, b) => b.end - a.end)
  return done.length > 0 ? toMoment(done[0]) : null
}

/** 记录待办时的上下文课程：正在上的优先，其次刚下课的 */
export function captureContext(snap: Snapshot, date: LocalDate, now: Minutes): ClassMoment | null {
  return currentClass(snap, date, now) ?? justEndedClass(snap, date, now)
}

/** 某门课在此刻之后的下一次上课；lookAheadDays 天内找不到返回 null */
export function nextClassOf(
  snap: Snapshot,
  courseId: string,
  date: LocalDate,
  now: Minutes,
  lookAheadDays = 21,
): ClassMoment | null {
  for (let i = 0; i <= lookAheadDays; i++) {
    const d = addDays(date, i)
    const list = occurrencesOn(snap, d)
      .filter((o) => o.courseId === courseId && o.status !== 'cancelled')
      .filter((o) => i > 0 || o.start > now)
      .sort((a, b) => a.start - b.start)
    if (list.length > 0) return toMoment(list[0])
  }
  return null
}

/** 快速记录的默认截止：这门课下次上课前；没有下次课时退回今晚 23:00 */
export function suggestedDue(
  snap: Snapshot,
  courseId: string | undefined,
  date: LocalDate,
  now: Minutes,
): { due: LocalDate; dueMinutes: Minutes; beforeClass: boolean } {
  const next = courseId ? nextClassOf(snap, courseId, date, now) : null
  if (next) return { due: next.date, dueMinutes: next.start, beforeClass: true }
  return { due: date, dueMinutes: 23 * 60, beforeClass: false }
}
