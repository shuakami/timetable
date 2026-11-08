import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { occurrenceOnDate, occurrencesOn, type Snapshot } from '../engine'
import { weeksToMask } from '../weeks'

/* 「编辑本次」按周定位：规则在任意一周的原定日期都能取到那一次，
   包括已调走、假期里展开不出的；别的周调过来的不算这周的。 */

const sem: Semester = {
  id: 's1',
  name: '秋',
  startDate: '2026-08-31', // 周一
  totalWeeks: 20,
  timeGrid: [...Array(10)].map((_, i) => ({ index: i + 1, start: 480 + i * 55, end: 525 + i * 55 })),
  vacations: [],
  examWeeks: [],
}

const course = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#000', identityKey: 'k', hidden: false, source: 'import' as const }
const rule = { id: 'r1', courseId: 'c1', weekday: 1 as const, startPeriod: 1, endPeriod: 2, weeksMask: weeksToMask([1, 2, 3, 5, 9]), location: '教三302' }

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return { semester: sem, courses: [course], rules: [rule], overrides: [], entries: [], ...partial }
}

describe('occurrenceOnDate', () => {
  it('规则排的那一周：返回展开结果，originDate 与 date 相同', () => {
    const o = occurrenceOnDate(snap(), 'r1', '2026-08-31')!
    expect(o).toBeTruthy()
    expect(o.date).toBe('2026-08-31')
    expect(o.originDate).toBe('2026-08-31')
    expect(o.startPeriod).toBe(1)
    expect(o.endPeriod).toBe(2)
    expect(o.start).toBe(480)
    expect(o.status).toBe('normal')
    expect(o.location).toBe('教三302')
  })

  it('不在周次掩码、星期不对、规则不存在都返回 null', () => {
    const s = snap()
    expect(occurrenceOnDate(s, 'r1', '2026-09-21')).toBeNull() // 第 4 周不在掩码
    expect(occurrenceOnDate(s, 'r1', '2026-09-01')).toBeNull() // 周二，规则是周一
    expect(occurrenceOnDate(s, 'nope', '2026-08-31')).toBeNull()
    expect(occurrenceOnDate(s, 'r1', '2026-08-24')).toBeNull() // 学期前
  })

  it('隐藏的课返回 null', () => {
    expect(occurrenceOnDate(snap({ courses: [{ ...course, hidden: true }] }), 'r1', '2026-08-31')).toBeNull()
  })

  it('已调走的那一次：原定日期取不到展开结果时按 Override 合成，date 仍是原定日期', () => {
    const s = snap({
      overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-09-14', kind: 'moved', newDate: '2026-09-16', newStartPeriod: 3, newEndPeriod: 4, createdAt: 0 }],
    })
    // 原定那天确实没有课了
    expect(occurrencesOn(s, '2026-09-14').filter((o) => o.ruleId === 'r1')).toHaveLength(0)
    const o = occurrenceOnDate(s, 'r1', '2026-09-14')!
    expect(o.date).toBe('2026-09-14')
    expect(o.originDate).toBe('2026-09-14')
    expect(o.status).toBe('moved')
    expect(o.startPeriod).toBe(3)
    expect(o.endPeriod).toBe(4)
    expect(o.start).toBe(590)
  })

  it('别的周调过来的课不算这周的：本周自己的那一次优先', () => {
    const s = snap({
      overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'moved', newDate: '2026-09-07', createdAt: 0 }],
    })
    // 9/7 这天同一规则有两条：第 2 周自己的 + 第 1 周调过来的
    const day = occurrencesOn(s, '2026-09-07').filter((o) => o.ruleId === 'r1')
    expect(day).toHaveLength(2)
    expect(day.find((o) => o.originDate === '2026-08-31')?.status).toBe('moved')
    const o = occurrenceOnDate(s, 'r1', '2026-09-07')!
    expect(o.date).toBe('2026-09-07')
    expect(o.originDate).toBe('2026-09-07')
    expect(o.status).toBe('normal')
    expect(o.startPeriod).toBe(1)
  })

  it('停课/请假的那一次照常返回，状态带出', () => {
    const s = snap({
      overrides: [
        { id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'cancelled', createdAt: 0 },
        { id: 'o2', ruleId: 'r1', date: '2026-09-07', kind: 'leave', createdAt: 0 },
      ],
    })
    expect(occurrenceOnDate(s, 'r1', '2026-08-31')?.status).toBe('cancelled')
    expect(occurrenceOnDate(s, 'r1', '2026-09-07')?.status).toBe('leave')
  })
})
