import type { Semester } from './types'
import type { DesiredEvent } from './calendar-plan'

/* 课表导出为标准 .ics：任何日历应用都能直接打开；
   另附一段课程表自己的字段（X-TT-*），本应用打开时按原样还原学期、节次表与颜色。 */

export const ICS_MIME = 'text/calendar'

/** 文件头里的学期信息，导入时用来对齐周次与节次 */
export interface IcsSemester {
  name: string
  startDate: string
  totalWeeks: number
  timeGrid: Semester['timeGrid']
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地墙钟时刻：20250901T080000 */
function localStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function dateStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** 20250901T000000Z → 本地墙钟 */
function utcToLocalStamp(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s)
  if (!m) return s
  return localStamp(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545：一行最多 75 字节，续行以一个空格开头 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (len + n > limit) {
      out.push(cur)
      cur = ''
      len = 0
    }
    cur += ch
    len += n
  }
  if (cur) out.push(cur)
  return out.join('\r\n ')
}

function uidOf(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]/g, '-')}@timetable`
}

export interface IcsOptions {
  /** 日历名，进对方日历后的显示名 */
  name: string
  semester: IcsSemester
  /** 课程 id → 颜色，随事件带走 */
  colors?: Map<string, string>
  now?: Date
}

/** 把计划好的事件序列化成 .ics 文本（停课 / 请假的事件不导出） */
export function buildIcs(events: DesiredEvent[], opt: IcsOptions): string {
  const tz = events[0]?.event.tz ?? 'UTC'
  const stamp = `${localStamp((opt.now ?? new Date()).getTime())}`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//timetable//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opt.name)}`,
    `X-WR-TIMEZONE:${tz}`,
    `X-TT-SEMESTER:${escapeText(JSON.stringify(opt.semester))}`,
  ]
  for (const e of events) {
    const b = e.event
    if (b.cancelled) continue
    lines.push('BEGIN:VEVENT', `UID:${uidOf(e.key)}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(b.title)}`)
    if (b.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(b.start)}`)
      if (b.end != null) lines.push(`DTEND;VALUE=DATE:${dateStamp(b.end)}`)
    } else {
      lines.push(`DTSTART;TZID=${tz}:${localStamp(b.start)}`)
      if (b.rrule) {
        lines.push(`DURATION:${b.duration ?? 'PT45M'}`, `RRULE:${b.rrule}`)
        if (b.exdate) lines.push(`EXDATE;TZID=${tz}:${b.exdate.split(',').map(utcToLocalStamp).join(',')}`)
      } else if (b.end != null) {
        lines.push(`DTEND;TZID=${tz}:${localStamp(b.end)}`)
      }
    }
    if (b.location) lines.push(`LOCATION:${escapeText(b.location)}`)
    if (b.description) lines.push(`DESCRIPTION:${escapeText(b.description)}`)
    lines.push(`TRANSP:${b.busy ? 'OPAQUE' : 'TRANSPARENT'}`)
    const courseId = /^tt\.c\.(.+)$/.exec(e.calendar)?.[1]
    const color = courseId ? opt.colors?.get(courseId) : undefined
    if (color) lines.push(`X-TT-COLOR:${color}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** 文件名：学期名.ics，去掉文件系统不认的字符 */
export function icsFileName(semesterName: string): string {
  const base = semesterName.trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${base || '课表'}.ics`
}
