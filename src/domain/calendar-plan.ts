import type { LocalDate, Minutes, Prefs, Task } from './types'
import { addDays, atMinutes, dateOf, diffDays, fromDate, weekdayOf } from './dates'
import { occurrencesOn, type Snapshot } from './engine'

/* 系统日历计划：纯函数，把课表 + 待办 + 提醒模板算成「日历里应该有哪些事件」。
   每条事件有稳定 key，同一件事两次算出同一个 key；写入与差异在 src/app/calendar.ts。 */

export interface CalendarEventBody {
  title: string
  location?: string
  description?: string
  /** epoch ms；全天事件为该日 UTC 零点 */
  start: number
  /** 单次事件的结束（ms）；重复事件用 duration */
  end?: number
  /** RFC 5545 时长，仅重复事件 */
  duration?: string
  rrule?: string
  exdate?: string
  allDay: boolean
  tz: string
  color?: string
  busy: boolean
  /** 系统日历事件详情里「在应用中打开」的目标 */
  link?: string
}

export type DesiredKind = 'course' | 'task' | 'exam' | 'week'

/** 每门课一本日历（用课程自己的颜色），作业、考试、周次各一本 */
export type CalendarSlug = string
export const courseCalendar = (courseId: string): CalendarSlug => `tt.c.${courseId}`
export const TASK_CALENDAR: CalendarSlug = 'tt.task'
export const EXAM_CALENDAR: CalendarSlug = 'tt.exam'
export const WEEK_CALENDAR: CalendarSlug = 'tt.week'
export const OTHER_CALENDAR: CalendarSlug = 'tt.course'

export interface CalendarSpec {
  slug: CalendarSlug
  name: string
  /** 课程自己的颜色；作业 / 考试 / 周次由调用方按主题填 */
  color?: string
}

/** 期望事件用到的全部日历 */
export function calendarsFor(events: DesiredEvent[], snap: Snapshot | null): CalendarSpec[] {
  const byId = new Map((snap?.courses ?? []).map((c) => [courseCalendar(c.id), c]))
  const out = new Map<CalendarSlug, CalendarSpec>()
  for (const e of events) {
    if (out.has(e.calendar)) continue
    const c = byId.get(e.calendar)
    const name = c ? c.name : e.calendar === TASK_CALENDAR ? '作业' : e.calendar === EXAM_CALENDAR ? '考试' : e.calendar === WEEK_CALENDAR ? '周次' : '上课'
    out.set(e.calendar, { slug: e.calendar, name: `课程表 ${name}`, color: c?.color })
  }
  return [...out.values()]
}

export interface DesiredEvent {
  key: string
  kind: DesiredKind
  calendar: CalendarSlug
  event: CalendarEventBody
  /** 提前多少分钟提醒（去重、升序） */
  reminders: Minutes[]
}

const DAY_MIN = 24 * 60
const BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
/** 这个点之前开始的课算早课 */
const EARLY_BEFORE: Minutes = 8 * 60 + 30
/** 待办已过期超过这么多天就不再占日历 */
const TASK_KEEP_DAYS = 30
/** 没写时刻的作业按当天这个时间截止 */
const UNTIMED_DUE: Minutes = 23 * 60
/** 一个课程系列只有这么少次时，直接写单次事件 */
const MIN_SERIES = 3

function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** RFC 5545 UTC 时刻：20240311T010000Z */
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function utcMidnight(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function uniqSorted(list: Minutes[]): Minutes[] {
  return [...new Set(list.filter((m) => Number.isFinite(m) && m >= 0))].sort((a, b) => a - b)
}

/** 有具体时刻的事件：截止前多久 */
function timedLeads(leads: Minutes[]): Minutes[] {
  return uniqSorted(leads.filter((m) => m > 0))
}

/** 考试：提前 d 天的早 8 点；d=0 且当天开考晚于 8 点就是当天 8 点，否则退到考前 1 小时 */
function examLeadsTimed(days: number[], startMin: Minutes): Minutes[] {
  return uniqSorted(days.map((d) => {
    const m = d * DAY_MIN + startMin - 8 * 60
    return m > 0 ? m : 60
  }))
}

function examLeadsAllDay(days: number[]): Minutes[] {
  return uniqSorted(days.map((d) => (d <= 0 ? 4 * 60 : d * DAY_MIN - 8 * 60)))
}

function joinLocation(parts: (string | undefined)[]): string | undefined {
  const s = parts.filter((x): x is string => !!x && x.trim().length > 0).map((x) => x.trim()).join(' ')
  return s.length > 0 ? s : undefined
}

interface SeriesItem {
  date: LocalDate
  start: Minutes
  end: Minutes
  name: string
  location?: string
  teacher?: string
  color?: string
  startPeriod: number
  endPeriod: number
  link?: string
  courseId?: string
  reminders: Minutes[]
}

const courseSlug = (courseId?: string): CalendarSlug => (courseId ? courseCalendar(courseId) : OTHER_CALENDAR)

function classReminders(prefs: Prefs, start: Minutes): Minutes[] {
  const out = [prefs.classLead]
  if (start <= EARLY_BEFORE && prefs.earlyLead > prefs.classLead) out.push(prefs.earlyLead)
  return uniqSorted(out)
}

function single(key: string, it: SeriesItem, tz: string, suffix = ''): DesiredEvent {
  return {
    key,
    kind: 'course',
    calendar: courseSlug(it.courseId),
    event: {
      title: `${it.name}${suffix}`,
      location: it.location,
      description: it.teacher?.trim() || undefined,
      start: atMinutes(it.date, it.start),
      end: atMinutes(it.date, it.end),
      allDay: false,
      tz,
      color: it.color,
      busy: true,
      link: it.link,
    },
    reminders: it.reminders,
  }
}

/**
 * 同一条规则的常规课合成一个重复事件：每周或每两周，中间缺的周用 EXDATE 挖掉。
 * 次数太少、或缺的比留的多，就退化成单次事件。
 */
function series(keyBase: string, items: SeriesItem[], tz: string): DesiredEvent[] {
  const sorted = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const first = sorted[0]
  const singles = () => sorted.map((it) => single(`${keyBase}:${it.date}`, it, tz))
  if (sorted.length < MIN_SERIES) return singles()

  const weeks = sorted.map((it) => diffDays(it.date, first.date) / 7)
  if (weeks.some((w) => !Number.isInteger(w))) return singles()
  const span = weeks[weeks.length - 1]
  const biweekly = weeks.every((w, i) => w === i * 2)
  const interval = biweekly ? 2 : 1
  const have = new Set(weeks)
  const missing: number[] = []
  for (let w = 0; w <= span; w += interval) if (!have.has(w)) missing.push(w)
  if (missing.length > sorted.length) return singles()

  const count = Math.floor(span / interval) + 1
  const rrule = `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${BYDAY[weekdayOf(first.date)]};COUNT=${count}`
  const exdate = missing.map((w) => utcStamp(atMinutes(addDays(first.date, w * 7), first.start))).join(',')
  return [{
    key: keyBase,
    kind: 'course',
    calendar: courseSlug(first.courseId),
    event: {
      title: first.name,
      location: first.location,
      description: first.teacher?.trim() || undefined,
      start: atMinutes(first.date, first.start),
      duration: `PT${Math.max(1, first.end - first.start)}M`,
      rrule,
      exdate: exdate.length > 0 ? exdate : undefined,
      allDay: false,
      tz,
      color: first.color,
      busy: true,
      link: first.link,
    },
    reminders: first.reminders,
  }]
}

function planCourses(snap: Snapshot, prefs: Prefs, tz: string): DesiredEvent[] {
  const sem = snap.semester
  let from = sem.startDate
  let to = dateOf(sem, sem.totalWeeks, 7)
  for (const ov of snap.overrides) if (ov.kind === 'moved' && ov.newDate) { if (ov.newDate < from) from = ov.newDate; if (ov.newDate > to) to = ov.newDate }
  for (const en of snap.entries) if (en.date) { if (en.date < from) from = en.date; if (en.date > to) to = en.date }

  const groups = new Map<string, SeriesItem[]>()
  const out: DesiredEvent[] = []
  const days = diffDays(to, from)
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i)
    for (const o of occurrencesOn(snap, date)) {
      if (o.status === 'cancelled' || o.status === 'leave') continue
      const link = o.courseId ? `timetable://open/course/${o.courseId}` : `timetable://open/day/${date}`
      const item: SeriesItem = {
        date, start: o.start, end: o.end, name: o.name,
        location: o.location, teacher: o.teacher, color: o.color,
        startPeriod: o.startPeriod, endPeriod: o.endPeriod, link, courseId: o.courseId,
        reminders: o.muted ? [] : classReminders(prefs, o.start),
      }
      if (o.status === 'moved') {
        out.push(single(`mv:${o.key}`, item, tz, '（调课）'))
      } else if (o.muted) {
        // 这一次不提醒：从系列里挖出来，单独写一条没有提醒的
        out.push(single(`mu:${o.key}`, item, tz))
      } else {
        const base = o.ruleId ? `c:${o.ruleId}` : `e:${o.entryId ?? o.key}`
        const list = groups.get(base)
        if (list) list.push(item); else groups.set(base, [item])
      }
    }
  }
  for (const [base, items] of groups) {
    // 同一规则下节次/地点不同的（理论上只有调课会造成，已单独处理）分开成系列
    const byShape = new Map<string, SeriesItem[]>()
    for (const it of items) {
      const shape = `${it.startPeriod}-${it.endPeriod}|${it.start}-${it.end}|${weekdayOf(it.date)}`
      const l = byShape.get(shape)
      if (l) l.push(it); else byShape.set(shape, [it])
    }
    let n = 0
    for (const l of byShape.values()) {
      out.push(...series(n === 0 ? base : `${base}#${n}`, l, tz))
      n++
    }
  }
  return out
}

/** 每周一一条全天的「第 N 周」，打开日历就知道这是第几周 */
function planWeeks(snap: Snapshot, tz: string): DesiredEvent[] {
  const sem = snap.semester
  const out: DesiredEvent[] = []
  for (let w = 1; w <= sem.totalWeeks; w++) {
    const monday = dateOf(sem, w, 1)
    const start = utcMidnight(monday)
    out.push({
      key: `w:${w}`,
      kind: 'week',
      calendar: WEEK_CALENDAR,
      event: { title: `第 ${w} 周`, start, end: start + DAY_MIN * 60000, allDay: true, tz, busy: false, link: `timetable://open/day/${monday}` },
      reminders: [],
    })
  }
  return out
}

function planTasks(tasks: Task[], courseName: Map<string, string>, courseColor: Map<string, string>, prefs: Prefs, today: LocalDate, tz: string): DesiredEvent[] {
  const out: DesiredEvent[] = []
  for (const t of tasks) {
    if (t.done || !t.due || t.inbox || t.title.trim().length === 0) continue
    if (diffDays(today, t.due) > TASK_KEEP_DAYS) continue
    const course = t.courseId ? courseName.get(t.courseId) : undefined
    const color = t.courseId ? courseColor.get(t.courseId) : undefined
    const isExam = t.kind === 'exam'
    const name = t.title.trim()
    const title = `${isExam && !name.includes('考') ? `${name}考试` : name}${course ? `（${course}）` : ''}`
    const location = isExam ? joinLocation([t.location, t.seat ? `座位 ${t.seat}` : undefined]) : joinLocation([t.location])
    const link = `timetable://open/task/${t.id}`
    const description = t.note?.trim() || undefined
    let body: CalendarEventBody
    let reminders: Minutes[]
    if (isExam && t.dueMinutes == null) {
      // 只知道哪天考：全天事件，提前 N 天的早上提醒
      const start = utcMidnight(t.due)
      body = { title, location, description, start, end: start + DAY_MIN * 60000, allDay: true, tz, color, busy: false, link }
      reminders = examLeadsAllDay(prefs.examDays)
    } else {
      const startMin = t.dueMinutes ?? UNTIMED_DUE
      const start = atMinutes(t.due, startMin)
      const endMin = isExam ? (t.endMinutes != null && t.endMinutes > startMin ? t.endMinutes : startMin + 120) : startMin + 30
      body = { title, location, description, start, end: atMinutes(t.due, endMin), allDay: false, tz, color, busy: isExam, link }
      reminders = isExam ? examLeadsTimed(prefs.examDays, startMin) : timedLeads(prefs.taskLeads)
    }
    out.push({ key: `t:${t.id}`, kind: isExam ? 'exam' : 'task', calendar: isExam ? EXAM_CALENDAR : TASK_CALENDAR, event: body, reminders })
  }
  return out
}

/** 日历里应该有的全部事件 */
export function planCalendar(snap: Snapshot | null, tasks: Task[], prefs: Prefs, now: Date): DesiredEvent[] {
  const tz = localTz()
  const today = fromDate(now)
  const courseName = new Map(snap?.courses.map((c) => [c.id, c.name]) ?? [])
  const courseColor = new Map(snap?.courses.map((c) => [c.id, c.color]) ?? [])
  const out: DesiredEvent[] = []
  if (snap) out.push(...planCourses(snap, prefs, tz), ...planWeeks(snap, tz))
  out.push(...planTasks(tasks, courseName, courseColor, prefs, today, tz))
  return out
}

export interface CalendarSummary {
  courses: number
  tasks: number
  exams: number
}

/** 汇总给设置页看：几门课（按课名）、几项作业、几场考试 */
export function summarize(events: DesiredEvent[]): CalendarSummary {
  let tasks = 0, exams = 0
  const courses = new Set<string>()
  for (const e of events) {
    if (e.kind === 'exam') exams++
    else if (e.kind === 'task') tasks++
    else if (e.kind === 'course') courses.add(e.event.title.replace(/（调课）$/, ''))
  }
  return { courses: courses.size, tasks, exams }
}

/** 稳定哈希：事件内容 + 提醒，任何一处变了都不同 */
export function eventHash(e: DesiredEvent): string {
  const s = JSON.stringify([e.event, e.reminders])
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`
}
