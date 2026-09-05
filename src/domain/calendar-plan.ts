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

export type DesiredKind = 'course' | 'task' | 'exam'

export interface DesiredEvent {
  key: string
  kind: DesiredKind
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

/** 全天事件：把「提前 N 天」落到前 N 天的晚上 8 点；不满一天的都归到前一晚 8 点 */
function allDayLeads(leads: Minutes[]): Minutes[] {
  return uniqSorted(leads.map((m) => {
    const days = Math.max(1, Math.ceil(m / DAY_MIN))
    return days * DAY_MIN - 20 * 60
  }))
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
  const s = parts.filter((x): x is string => !!x && x.trim().length > 0).map((x) => x.trim()).join(' · ')
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
  reminders: Minutes[]
}

function classReminders(prefs: Prefs, start: Minutes): Minutes[] {
  const out = [prefs.classLead]
  if (start <= EARLY_BEFORE && prefs.earlyLead > prefs.classLead) out.push(prefs.earlyLead)
  return uniqSorted(out)
}

function periodText(sp: number, ep: number): string {
  return sp === ep ? `第 ${sp} 节` : `第 ${sp}–${ep} 节`
}

function single(key: string, it: SeriesItem, tz: string): DesiredEvent {
  return {
    key,
    kind: 'course',
    event: {
      title: it.name,
      location: it.location,
      description: joinLocation([periodText(it.startPeriod, it.endPeriod), it.teacher]),
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
    event: {
      title: first.name,
      location: first.location,
      description: joinLocation([periodText(first.startPeriod, first.endPeriod), first.teacher]),
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
        startPeriod: o.startPeriod, endPeriod: o.endPeriod, link,
        reminders: o.muted ? [] : classReminders(prefs, o.start),
      }
      if (o.status === 'moved') {
        out.push(single(`mv:${o.key}`, item, tz))
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

function planTasks(tasks: Task[], courseName: Map<string, string>, courseColor: Map<string, string>, prefs: Prefs, today: LocalDate, tz: string): DesiredEvent[] {
  const out: DesiredEvent[] = []
  for (const t of tasks) {
    if (t.done || !t.due || t.inbox || t.title.trim().length === 0) continue
    if (diffDays(today, t.due) > TASK_KEEP_DAYS) continue
    const course = t.courseId ? courseName.get(t.courseId) : undefined
    const color = t.courseId ? courseColor.get(t.courseId) : undefined
    const isExam = t.kind === 'exam'
    const title = `${isExam ? '考试：' : ''}${t.title.trim()}${course ? ` — ${course}` : ''}`
    const location = isExam ? joinLocation([t.location, t.seat ? `座位 ${t.seat}` : undefined]) : joinLocation([t.location])
    const link = `timetable://open/task/${t.id}`
    const timed = t.dueMinutes != null
    let body: CalendarEventBody
    let reminders: Minutes[]
    if (timed) {
      const startMin = t.dueMinutes as Minutes
      const start = atMinutes(t.due, startMin)
      const endMin = isExam ? (t.endMinutes != null && t.endMinutes > startMin ? t.endMinutes : startMin + 120) : startMin + 30
      body = { title, location, description: t.note?.trim() || undefined, start, end: atMinutes(t.due, endMin), allDay: false, tz, color, busy: isExam, link }
      reminders = isExam ? examLeadsTimed(prefs.examDays, startMin) : timedLeads(prefs.taskLeads)
    } else {
      const start = utcMidnight(t.due)
      body = { title, location, description: t.note?.trim() || undefined, start, end: start + DAY_MIN * 60000, allDay: true, tz, color, busy: false, link }
      reminders = isExam ? examLeadsAllDay(prefs.examDays) : allDayLeads(prefs.taskLeads)
    }
    out.push({ key: `t:${t.id}`, kind: isExam ? 'exam' : 'task', event: body, reminders })
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
  if (snap) out.push(...planCourses(snap, prefs, tz))
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
    else courses.add(e.event.title)
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
