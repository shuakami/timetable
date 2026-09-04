import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { dateOf, weekOf, weekdayOf, inVacation } from '../dates'
import { occurrencesOn, identityKey, type Snapshot } from '../engine'
import { weeksToMask } from '../weeks'

const sem: Semester = {
  id: 's1',
  name: '秋季学期',
  startDate: '2026-08-31', // 周一
  totalWeeks: 20,
  timeGrid: [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
    { index: 3, start: 600, end: 645 },
    { index: 4, start: 655, end: 700 },
  ],
  vacations: [{ name: '国庆假期', start: '2026-10-01', end: '2026-10-07' }],
  examWeeks: [19, 20],
}

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return { semester: sem, courses: [], rules: [], overrides: [], entries: [], ...partial }
}

const course = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#4F5BD5', identityKey: 'k', hidden: false, source: 'import' as const }
const rule = { id: 'r1', courseId: 'c1', weekday: 1 as const, startPeriod: 1, endPeriod: 2, weeksMask: weeksToMask([1, 2, 3, 5]), location: '教三 302' }

describe('dates', () => {
  it('weekOf/dateOf', () => {
    expect(weekOf(sem, '2026-08-31')).toBe(1)
    expect(weekOf(sem, '2026-09-07')).toBe(2)
    expect(dateOf(sem, 2, 1)).toBe('2026-09-07')
    expect(dateOf(sem, 1, 7)).toBe('2026-09-06')
  })
  it('weekdayOf monday=1 sunday=7', () => {
    expect(weekdayOf('2026-08-31')).toBe(1)
    expect(weekdayOf('2026-09-06')).toBe(7)
  })
  it('inVacation', () => {
    expect(inVacation(sem, '2026-10-03')).toBe('国庆假期')
    expect(inVacation(sem, '2026-10-08')).toBeNull()
  })
})

describe('occurrencesOn', () => {
  it('expands rule on matching week/weekday', () => {
    const s = snap({ courses: [course], rules: [rule] })
    const occ = occurrencesOn(s, '2026-08-31') // 第1周周一
    expect(occ).toHaveLength(1)
    expect(occ[0].name).toBe('高等数学')
    expect(occ[0].start).toBe(480)
  })
  it('skips weeks not in mask', () => {
    const s = snap({ courses: [course], rules: [rule] })
    expect(occurrencesOn(s, '2026-09-21')).toHaveLength(0) // 第4周不在掩码
  })
  it('skips out-of-term and vacation', () => {
    const s = snap({ courses: [course], rules: [rule] })
    expect(occurrencesOn(s, '2026-08-24')).toHaveLength(0) // 学期前
    const vacSem = { ...sem, vacations: [{ name: '假', start: '2026-08-31', end: '2026-08-31' }] }
    expect(occurrencesOn({ ...s, semester: vacSem }, '2026-08-31')).toHaveLength(0)
  })
  it('hidden course not expanded', () => {
    const s = snap({ courses: [{ ...course, hidden: true }], rules: [rule] })
    expect(occurrencesOn(s, '2026-08-31')).toHaveLength(0)
  })
  it('cancelled override keeps occurrence with status', () => {
    const s = snap({
      courses: [course], rules: [rule],
      overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'cancelled', createdAt: 0 }],
    })
    const occ = occurrencesOn(s, '2026-08-31')
    expect(occ[0].status).toBe('cancelled')
  })
  it('moved override relocates to new date', () => {
    const s = snap({
      courses: [course], rules: [rule],
      overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'moved', newDate: '2026-09-01', newStartPeriod: 3, newEndPeriod: 4, createdAt: 0 }],
    })
    expect(occurrencesOn(s, '2026-08-31')).toHaveLength(0)
    const occ = occurrencesOn(s, '2026-09-01')
    expect(occ).toHaveLength(1)
    expect(occ[0].status).toBe('moved')
    expect(occ[0].start).toBe(600)
  })
  it('user entry weekly + conflict detection', () => {
    const s = snap({
      courses: [course], rules: [rule],
      entries: [{ id: 'e1', semesterId: 's1', name: '自习', kind: 'study', weekday: 1, startPeriod: 1, endPeriod: 2, createdAt: 0 }],
    })
    const occ = occurrencesOn(s, '2026-08-31')
    expect(occ).toHaveLength(2)
    expect(occ.every((o) => o.conflict)).toBe(true)
  })
  it('no conflict when times differ', () => {
    const s = snap({
      courses: [course], rules: [rule],
      entries: [{ id: 'e1', semesterId: 's1', name: '自习', kind: 'study', weekday: 1, startPeriod: 3, endPeriod: 4, createdAt: 0 }],
    })
    expect(occurrencesOn(s, '2026-08-31').some((o) => o.conflict)).toBe(false)
  })
  it('one-off entry only on its date', () => {
    const s = snap({ entries: [{ id: 'e1', semesterId: 's1', name: '复习', kind: 'temp', date: '2026-09-01', startPeriod: 1, endPeriod: 1, createdAt: 0 }] })
    expect(occurrencesOn(s, '2026-09-01')).toHaveLength(1)
    expect(occurrencesOn(s, '2026-09-08')).toHaveLength(0)
  })
})

describe('identityKey', () => {
  it('stable across whitespace', () => {
    expect(identityKey('高等 数学', '王立群', 1, 1)).toBe(identityKey('高等数学', '王 立群', 1, 1))
  })
  it('differs by teacher', () => {
    expect(identityKey('高数', '甲', 1, 1)).not.toBe(identityKey('高数', '乙', 1, 1))
  })
})
