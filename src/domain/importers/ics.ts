import type { Diagnostic, Semester } from '../types'
import type { RuleCourse, RuleOutput } from '../importer'
import { weekOf, weekdayOf } from '../dates'
 
/* ICS 日历导入：VEVENT → 课程。
   - DTSTART/DTEND 定位星期与节次（按节次表就近对齐）
   - RRULE FREQ=WEEKLY（INTERVAL/UNTIL/COUNT）展开为周次
   - 无 RRULE 的按单次事件，落在哪周就是哪周 */
 
interface VEvent {
  summary?: string
  location?: string
  description?: string
  dtstart?: string
  dtend?: string
  rrule?: string
}
 
export function parseIcsEvents(text: string): VEvent[] {
  // 折行展开（RFC5545：续行以空格/Tab 开头）
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const events: VEvent[] = []
  let cur: VEvent | null = null
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {}
    else if (/^END:VEVENT/i.test(line)) {
      if (cur) events.push(cur)
      cur = null
    } else if (cur) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const key = line.slice(0, idx).split(';')[0].toUpperCase()
      const val = line.slice(idx + 1).trim()
      if (key === 'SUMMARY') cur.summary = unescapeIcs(val)
      else if (key === 'LOCATION') cur.location = unescapeIcs(val)
      else if (key === 'DESCRIPTION') cur.description = unescapeIcs(val)
      else if (key === 'DTSTART') cur.dtstart = val
      else if (key === 'DTEND') cur.dtend = val
      else if (key === 'RRULE') cur.rrule = val
    }
  }
  return events
}
 
function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}
 
/** '20250901T080000' / '20250901' → { date, minutes } （忽略时区，按本地墙钟） */
function parseIcsDt(v: string): { date: string; minutes: number } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/)
  if (!m) return null
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    minutes: m[4] ? parseInt(m[4], 10) * 60 + parseInt(m[5], 10) : 0,
  }
}
 
/** 时间 → 节次：起点取覆盖 start 的节（否则其后第一节），终点取覆盖 end 的节（否则其前最后一节） */
function periodsFor(sem: Semester, start: number, end: number): { start: number; end: number } | null {
  const grid = sem.timeGrid
  const sp = grid.find((t) => t.start <= start && start < t.end) ?? grid.find((t) => t.start >= start)
  const ep = [...grid].reverse().find((t) => t.start < end && end <= t.end) ?? [...grid].reverse().find((t) => t.end <= end)
  if (!sp || !ep || ep.index < sp.index) return null
  return { start: sp.index, end: ep.index }
}
 
export function parseIcs(text: string, sem: Semester): RuleOutput {
  const diags: Diagnostic[] = []
  const events = parseIcsEvents(text)
  if (events.length === 0) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_EVENTS', message: '没有找到日历事件' }] }
  }
  // 相同 课名|星期|节次 的事件合并周次
  const byKey = new Map<string, RuleCourse & { weekSet: Set<number> }>()
 
  for (const ev of events) {
    if (!ev.summary || !ev.dtstart) continue
    const st = parseIcsDt(ev.dtstart)
    const en = ev.dtend ? parseIcsDt(ev.dtend) : null
    if (!st) {
      diags.push({ level: 'error', code: 'BAD_DTSTART', message: `「${ev.summary}」开始时间无法解析`, at: { snippet: ev.dtstart } })
      continue
    }
    const endMin = en && en.date === st.date ? en.minutes : st.minutes + 90
    const pr = periodsFor(sem, st.minutes, endMin)
    if (!pr) {
      diags.push({ level: 'error', code: 'TIME_OUT_OF_GRID', message: `「${ev.summary}」时间不在节次表内` })
      continue
    }
    const weekday = weekdayOf(st.date)
    const weeks = expandWeeks(sem, st.date, ev.rrule)
    if (weeks.length === 0) {
      diags.push({ level: 'warn', code: 'OUT_OF_TERM', message: `「${ev.summary}」不在学期范围内，已跳过` })
      continue
    }
    const teacher = ev.description?.split('\n').find((l) => l && l !== ev.location)?.trim() || undefined
    const key = `${ev.summary}|${weekday}|${pr.start}-${pr.end}`
    const ex = byKey.get(key)
    if (ex) weeks.forEach((w) => ex.weekSet.add(w))
    else byKey.set(key, { name: ev.summary, teacher, location: ev.location, weekday, startPeriod: pr.start, endPeriod: pr.end, weeks: '', weekSet: new Set(weeks) })
  }
 
  const courses: RuleCourse[] = [...byKey.values()].map(({ weekSet, ...rc }) => ({
    ...rc,
    weeks: [...weekSet].sort((a, b) => a - b).join(','),
  }))
  return { courses, diagnostics: diags }
}
 
function expandWeeks(sem: Semester, startDate: string, rrule?: string): number[] {
  const w0 = weekOf(sem, startDate)
  const inTerm = (w: number) => w >= 1 && w <= sem.totalWeeks
  if (!rrule) return inTerm(w0) ? [w0] : []
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]))
  if ((parts.FREQ ?? '').toUpperCase() !== 'WEEKLY') return inTerm(w0) ? [w0] : []
  const interval = parseInt(parts.INTERVAL ?? '1', 10) || 1
  let count = parts.COUNT ? parseInt(parts.COUNT, 10) : Infinity
  let untilWeek = sem.totalWeeks
  if (parts.UNTIL) {
    const u = parseIcsDt(parts.UNTIL)
    if (u) untilWeek = Math.min(untilWeek, weekOf(sem, u.date))
  }
  const weeks: number[] = []
  for (let w = w0; w <= untilWeek && count > 0; w += interval, count--) {
    if (inTerm(w)) weeks.push(w)
  }
  return weeks
}
