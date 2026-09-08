import type { Diagnostic, Semester } from '../types'
import { extractPhone, type RuleCourse, type RuleOutput } from '../importer'
import { weekOf, weekdayOf } from '../dates'
import type { IcsSemester } from '../ics'

/* ICS 日历导入：VEVENT → 课程。
   - DTSTART/DTEND 定位星期与节次（按节次表就近对齐）
   - 时区：浮动时间按墙钟；UTC（Z）和带 TZID 的换算到设备时区；TZID 不认识的按墙钟
   - RRULE FREQ=WEEKLY（INTERVAL/UNTIL/COUNT）展开为周次，EXDATE 挖掉
   - 无 RRULE 的按单次事件，落在哪周就是哪周
   - 课程表自己导出的文件头里带学期与节次表（X-TT-SEMESTER），按它对齐 */

interface VEvent {
  summary?: string
  location?: string
  description?: string
  dtstart?: string
  dtstartTz?: string
  dtend?: string
  dtendTz?: string
  rrule?: string
  exdate?: { v: string; tzid?: string }[]
  status?: string
  color?: string
}

export function parseIcsEvents(text: string): VEvent[] {
  return parseIcsFile(text).events
}

export function parseIcsFile(text: string): { events: VEvent[]; semester?: IcsSemester } {
  // 折行展开（RFC5545：续行以空格/Tab 开头）
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const events: VEvent[] = []
  let semester: IcsSemester | undefined
  let cur: VEvent | null = null
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {}
    else if (/^END:VEVENT/i.test(line)) {
      if (cur) events.push(cur)
      cur = null
    } else {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const [key, ...params] = line.slice(0, idx).split(';').map((s, i) => (i === 0 ? s.toUpperCase() : s))
      const tzid = params.find((p) => /^TZID=/i.test(p))?.slice(5).replace(/^"|"$/g, '')
      const val = line.slice(idx + 1).trim()
      if (!cur) {
        if (key === 'X-TT-SEMESTER') semester = parseSemester(unescapeIcs(val))
        continue
      }
      if (key === 'SUMMARY') cur.summary = unescapeIcs(val)
      else if (key === 'LOCATION') cur.location = unescapeIcs(val)
      else if (key === 'DESCRIPTION') cur.description = unescapeIcs(val)
      else if (key === 'DTSTART') {
        cur.dtstart = val
        cur.dtstartTz = tzid
      } else if (key === 'DTEND') {
        cur.dtend = val
        cur.dtendTz = tzid
      } else if (key === 'RRULE') cur.rrule = val
      else if (key === 'EXDATE') cur.exdate = [...(cur.exdate ?? []), ...val.split(',').map((v) => ({ v, tzid }))]
      else if (key === 'STATUS') cur.status = val.toUpperCase()
      else if (key === 'X-TT-COLOR') cur.color = /^#[0-9a-f]{6}$/i.test(val) ? val : undefined
    }
  }
  return { events, semester }
}

function parseSemester(json: string): IcsSemester | undefined {
  try {
    const o = JSON.parse(json) as Partial<IcsSemester>
    if (typeof o.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.startDate)) return undefined
    if (typeof o.totalWeeks !== 'number' || !(o.totalWeeks >= 1 && o.totalWeeks <= 60)) return undefined
    const grid = Array.isArray(o.timeGrid)
      ? o.timeGrid.filter((t) => typeof t.index === 'number' && typeof t.start === 'number' && typeof t.end === 'number' && t.end > t.start)
      : []
    if (grid.length === 0 || grid.some((t, i) => t.index !== i + 1)) return undefined
    return { name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '当前学期', startDate: o.startDate, totalWeeks: Math.round(o.totalWeeks), timeGrid: grid }
  } catch {
    return undefined
  }
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** 某一瞬间在时区 tz 的偏移（分）；tz 不认识返回 null */
function tzOffset(tz: string, utcMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(utcMs))
    const n = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
    return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - utcMs) / 60000)
  } catch {
    return null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const fromLocal = (d: Date) => ({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() })

/** '20250901T080000' / '20250901T000000Z' / '20250901' → 设备时区的 { date, minutes }。
    浮动时间和 TZID 不认识（或就是设备时区）的按墙钟；Z 和其他 TZID 换算；纯日期不动 */
export function parseIcsDt(v: string, tzid?: string): { date: string; minutes: number } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const wall = { date: `${m[1]}-${m[2]}-${m[3]}`, minutes: m[4] ? parseInt(m[4], 10) * 60 + parseInt(m[5], 10) : 0 }
  if (!m[4]) return wall
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  if (m[7]) return fromLocal(new Date(asUtc))
  if (!tzid || tzid === localTz()) return wall
  const off = tzOffset(tzid, asUtc)
  if (off == null) return wall
  const off2 = tzOffset(tzid, asUtc - off * 60000) ?? off
  return fromLocal(new Date(asUtc - off2 * 60000))
}

/** 时间 → 节次：起点取覆盖 start 的节（否则其后第一节），终点取覆盖 end 的节（否则其前最后一节） */
function periodsFor(sem: Semester, start: number, end: number): { start: number; end: number } | null {
  const grid = sem.timeGrid
  const sp = grid.find((t) => t.start <= start && start < t.end) ?? grid.find((t) => t.start >= start)
  const ep = [...grid].reverse().find((t) => t.start < end && end <= t.end) ?? [...grid].reverse().find((t) => t.end <= end)
  if (!sp || !ep || ep.index < sp.index) return null
  return { start: sp.index, end: ep.index }
}

export function parseIcs(text: string, current: Semester): RuleOutput {
  const diags: Diagnostic[] = []
  const { events, semester } = parseIcsFile(text)
  if (events.length === 0) {
    return { courses: [], diagnostics: [{ level: 'error', code: 'NO_EVENTS', message: '没有找到日历事件' }] }
  }
  const sem: Semester = semester ? { ...current, ...semester } : current
  // 相同 课名|星期|节次 的事件合并周次
  const byKey = new Map<string, RuleCourse & { weekSet: Set<number> }>()

  for (const ev of events) {
    if (!ev.summary || !ev.dtstart) continue
    // 全天事件（周次标记之类）和已取消的不是课
    if (!ev.dtstart.includes('T') || ev.status === 'CANCELLED') continue
    const st = parseIcsDt(ev.dtstart, ev.dtstartTz)
    const en = ev.dtend ? parseIcsDt(ev.dtend, ev.dtendTz) : null
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
    const weeks = expandWeeks(sem, st.date, ev.rrule, ev.exdate)
    if (weeks.length === 0) {
      diags.push({ level: 'warn', code: 'OUT_OF_TERM', message: `「${ev.summary}」不在学期范围内，已跳过` })
      continue
    }
    const teacherPhone = extractPhone(ev.description)
    const teacher = ev.description?.split('\n').find((l) => l && l !== ev.location && !extractPhone(l))?.trim() || undefined
    const key = `${ev.summary}|${weekday}|${pr.start}-${pr.end}`
    const ex = byKey.get(key)
    if (ex) weeks.forEach((w) => ex.weekSet.add(w))
    else byKey.set(key, { name: ev.summary, teacher, teacherPhone, location: ev.location, weekday, startPeriod: pr.start, endPeriod: pr.end, weeks: '', color: ev.color, weekSet: new Set(weeks) })
  }

  const courses: RuleCourse[] = [...byKey.values()].map(({ weekSet, ...rc }) => ({
    ...rc,
    weeks: [...weekSet].sort((a, b) => a - b).join(','),
  }))
  return {
    courses,
    diagnostics: diags,
    ...(semester ? { timeGrid: semester.timeGrid, semester: { name: semester.name, startDate: semester.startDate, totalWeeks: semester.totalWeeks } } : {}),
  }
}

function expandWeeks(sem: Semester, startDate: string, rrule?: string, exdate?: { v: string; tzid?: string }[]): number[] {
  const w0 = weekOf(sem, startDate)
  const inTerm = (w: number) => w >= 1 && w <= sem.totalWeeks
  if (!rrule) return inTerm(w0) ? [w0] : []
  const skip = new Set((exdate ?? []).map((d) => parseIcsDt(d.v, d.tzid)).filter((x): x is { date: string; minutes: number } => x != null).map((x) => weekOf(sem, x.date)))
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
    if (inTerm(w) && !skip.has(w)) weeks.push(w)
  }
  return weeks
}
