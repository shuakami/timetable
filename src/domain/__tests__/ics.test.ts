import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { defaultPrefs } from '../types'
import type { Snapshot } from '../engine'
import { weeksToMask } from '../weeks'
import { planCalendar } from '../calendar-plan'
import { buildIcs, icsFileName } from '../ics'
import { parseIcs } from '../importers/ics'

const sem: Semester = {
  id: 's1',
  name: '2026 秋季',
  startDate: '2026-08-31',
  totalWeeks: 8,
  timeGrid: [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
    { index: 3, start: 600, end: 645 },
    { index: 4, start: 655, end: 700 },
  ],
  vacations: [],
  examWeeks: [],
}
const course = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', teacherPhone: '13800138000', color: '#4FA3A1', identityKey: 'k', hidden: false, source: 'import' as const }
const weekly = { id: 'r1', courseId: 'c1', weekday: 1 as const, startPeriod: 1, endPeriod: 2, weeksMask: weeksToMask([1, 2, 4, 5, 6, 7, 8]), location: '教三 302' }
const snap: Snapshot = {
  semester: sem, courses: [course], rules: [weekly],
  overrides: [{ id: 'o1', kind: 'cancelled', ruleId: 'r1', date: '2026-09-28', createdAt: 0 }],
  entries: [],
}
const now = new Date('2026-09-01T12:00:00')

function exportIcs() {
  const events = planCalendar(snap, [], defaultPrefs(), now).filter((e) => e.kind === 'course')
  return buildIcs(events, {
    name: sem.name,
    semester: { name: sem.name, startDate: sem.startDate, totalWeeks: sem.totalWeeks, timeGrid: sem.timeGrid },
    colors: new Map([['c1', course.color]]),
    now,
  })
}

describe('ICS 导出', () => {
  it('标准结构、CRLF、重复规则与挖掉的周', () => {
    const ics = exportIcs()
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:2026 秋季')
    expect(ics).toContain('SUMMARY:高等数学')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8')
    expect(ics).toContain('DURATION:PT100M')
    expect(ics).toMatch(/EXDATE;TZID=[^:]+:20260914T080000,20260928T080000/)
    expect(ics).toContain('LOCATION:教三 302')
    expect(ics).toContain('DESCRIPTION:王立群\\n13800138000')
    expect(ics).toContain('X-TT-COLOR:#4FA3A1')
    // 停课那条不导出
    expect(ics).not.toContain('停课')
    // 每一行都不超过 75 字节
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })

  it('自己导出的文件再导入：周次（停课那周挖掉）、节次、老师、电话、颜色原样回来', () => {
    const other: Semester = { ...sem, id: 'x', name: '别人的学期', startDate: '2026-02-23', totalWeeks: 16, timeGrid: sem.timeGrid.slice(0, 2) }
    const out = parseIcs(exportIcs(), other)
    expect(out.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    expect(out.semester).toEqual({ name: '2026 秋季', startDate: '2026-08-31', totalWeeks: 8 })
    expect(out.timeGrid).toHaveLength(4)
    expect(out.courses).toHaveLength(1)
    expect(out.courses[0]).toMatchObject({
      name: '高等数学', teacher: '王立群', teacherPhone: '13800138000', location: '教三 302',
      weekday: 1, startPeriod: 1, endPeriod: 2, weeks: '1,2,4,6,7,8', color: '#4FA3A1',
    })
  })

  it('文件名', () => {
    expect(icsFileName('2026 秋季')).toBe('2026 秋季.ics')
    expect(icsFileName('a/b:c')).toBe('a b c.ics')
    expect(icsFileName('  ')).toBe('课表.ics')
  })
})
