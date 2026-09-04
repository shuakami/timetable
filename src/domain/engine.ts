import type {
  Course, Occurrence, Override, Semester, SessionRule, UserEntry, LocalDate,
} from './types'
import { dateOf, inVacation, weekOf, weekdayOf } from './dates'
import { maskHasWeek } from './weeks'

export interface Snapshot {
  semester: Semester
  courses: Course[]
  rules: SessionRule[]
  overrides: Override[]
  entries: UserEntry[]
}

function slotTime(sem: Semester, startPeriod: number, endPeriod: number) {
  const s = sem.timeGrid.find((t) => t.index === startPeriod)
  const e = sem.timeGrid.find((t) => t.index === endPeriod)
  return { start: s?.start ?? 0, end: e?.end ?? 0 }
}

/** 展开某一天的全部 Occurrence（含手动条目与例外），按开始时间排序并标冲突。 */
export function occurrencesOn(snap: Snapshot, date: LocalDate): Occurrence[] {
  const { semester: sem } = snap
  const week = weekOf(sem, date)
  const wd = weekdayOf(date)
  const out: Occurrence[] = []
  if (week < 1 || week > sem.totalWeeks || inVacation(sem, date)) {
    // 学期外/假期：常规课不展开，但"调课到这一天"的和 UserEntry 里指定日期的仍显示
  } else {
    for (const rule of snap.rules) {
      const course = snap.courses.find((c) => c.id === rule.courseId)
      if (!course || course.hidden) continue
      if (rule.weekday !== wd || !maskHasWeek(rule.weeksMask, week)) continue
      const ov = snap.overrides.find((o) => o.ruleId === rule.id && o.date === date)
      if (ov?.kind === 'moved' && (ov.newDate ?? date) !== date) continue // 已调走
      const sp = ov?.kind === 'moved' ? ov.newStartPeriod ?? rule.startPeriod : rule.startPeriod
      const ep = ov?.kind === 'moved' ? ov.newEndPeriod ?? rule.endPeriod : rule.endPeriod
      const t = slotTime(sem, sp, ep)
      out.push({
        key: `${rule.id}@${date}`,
        courseId: course.id,
        ruleId: rule.id,
        name: course.name,
        date, week, weekday: wd,
        startPeriod: sp, endPeriod: ep,
        start: t.start, end: t.end,
        location: (ov?.kind === 'moved' && ov.newLocation) || rule.location,
        teacher: rule.teacher ?? course.teacher,
        color: course.color,
        status: ov ? (ov.kind === 'moved' ? 'moved' : ov.kind === 'muted' ? 'normal' : ov.kind) : 'normal',
        muted: ov?.kind === 'muted' || false,
        conflict: false,
        source: course.source,
      })
    }
  }
  // 调课调到 date 的
  for (const ov of snap.overrides) {
    if (ov.kind !== 'moved' || ov.newDate !== date || ov.date === date) continue
    const rule = snap.rules.find((r) => r.id === ov.ruleId)
    const course = rule && snap.courses.find((c) => c.id === rule.courseId)
    if (!rule || !course || course.hidden) continue
    const sp = ov.newStartPeriod ?? rule.startPeriod
    const ep = ov.newEndPeriod ?? rule.endPeriod
    const t = slotTime(sem, sp, ep)
    out.push({
      key: `${rule.id}@${ov.date}->${date}`,
      courseId: course.id, ruleId: rule.id,
      name: course.name,
      date, week, weekday: wd,
      startPeriod: sp, endPeriod: ep,
      start: t.start, end: t.end,
      location: ov.newLocation ?? rule.location,
      teacher: rule.teacher ?? course.teacher,
      color: course.color,
      status: 'moved', muted: false, conflict: false,
      source: course.source,
    })
  }
  // 手动条目
  for (const en of snap.entries) {
    const hit = en.date ? en.date === date : en.weekday === wd && week >= 1 && week <= sem.totalWeeks && !inVacation(sem, date)
    if (!hit) continue
    const t = slotTime(sem, en.startPeriod, en.endPeriod)
    out.push({
      key: `${en.id}@${date}`,
      entryId: en.id,
      name: en.name,
      date, week, weekday: wd,
      startPeriod: en.startPeriod, endPeriod: en.endPeriod,
      start: t.start, end: t.end,
      location: en.location,
      color: '#8A8E97',
      status: 'normal', muted: false, conflict: false,
      source: 'manual',
    })
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end)
  markConflicts(out)
  return out
}

export function markConflicts(list: Occurrence[]) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (a.status === 'cancelled' || b.status === 'cancelled') continue
      if (a.start < b.end && b.start < a.end) {
        a.conflict = true
        b.conflict = true
      }
    }
  }
}

/** 一周展开：weekday(1-7) → Occurrence[] */
export function occurrencesInWeek(snap: Snapshot, week: number): Map<number, Occurrence[]> {
  const m = new Map<number, Occurrence[]>()
  for (let wd = 1; wd <= 7; wd++) {
    m.set(wd, occurrencesOn(snap, dateOf(snap.semester, week, wd)))
  }
  return m
}

/** 课程身份键：跨导入认出同一门课 */
export function identityKey(name: string, teacher: string | undefined, weekday: number, startPeriod: number): string {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[（(].*?[)）]/g, (x) => x)
  return [norm(name), teacher ? norm(teacher) : '', weekday, startPeriod].join('|')
}
