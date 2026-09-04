import { describe, expect, it } from 'vitest'
import type { Course, Semester, SessionRule } from '../types'
import type { Snapshot } from '../engine'
import { weeksToMask } from '../weeks'
import { captureContext, currentClass, justEndedClass, nextClassOf, suggestedDue } from '../next-class'

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

const math: Course = {
  id: 'c1', semesterId: 's1', name: '高等数学（下）', teacher: '王立群',
  color: '#4F5BD5', identityKey: 'k1', hidden: false, source: 'import',
}
const eng: Course = {
  id: 'c2', semesterId: 's1', name: '大学英语（三）', teacher: '陈晓',
  color: '#22A06B', identityKey: 'k2', hidden: false, source: 'import',
}

// 高数：周一 1–2 节（08:00–09:45）、周四 3–4 节（10:00–11:40）
const mathMon: SessionRule = { id: 'r1', courseId: 'c1', weekday: 1, startPeriod: 1, endPeriod: 2, weeksMask: weeksToMask([1, 2, 3, 4]) }
const mathThu: SessionRule = { id: 'r2', courseId: 'c1', weekday: 4, startPeriod: 3, endPeriod: 4, weeksMask: weeksToMask([1, 2, 3, 4]) }
// 英语：周一 3–4 节
const engMon: SessionRule = { id: 'r3', courseId: 'c2', weekday: 1, startPeriod: 3, endPeriod: 4, weeksMask: weeksToMask([1, 2, 3, 4]) }

const snap: Snapshot = {
  semester: sem, courses: [math, eng], rules: [mathMon, mathThu, engMon], overrides: [], entries: [],
}

const MON = '2026-09-07' // 第 2 周周一
const THU = '2026-09-10' // 第 2 周周四

describe('currentClass', () => {
  it('上课中返回这门课', () => {
    expect(currentClass(snap, MON, 500)?.courseId).toBe('c1')
  })
  it('课间返回 null', () => {
    expect(currentClass(snap, MON, 590)).toBeNull()
  })
})

describe('justEndedClass', () => {
  it('下课 5 分钟内命中刚结束的一节', () => {
    const m = justEndedClass(snap, MON, 585)
    expect(m?.courseId).toBe('c1')
    expect(m?.end).toBe(580)
  })
  it('超过窗口返回 null', () => {
    expect(justEndedClass(snap, MON, 640, 30)).toBeNull()
  })
  it('两节都结束时取最近的一节', () => {
    expect(justEndedClass(snap, MON, 710)?.courseId).toBe('c2')
  })
})

describe('captureContext', () => {
  it('上课中优先当前课', () => {
    expect(captureContext(snap, MON, 610)?.courseId).toBe('c2')
  })
  it('下课后退回刚结束的课', () => {
    expect(captureContext(snap, MON, 585)?.courseId).toBe('c1')
  })
})

describe('nextClassOf', () => {
  it('同一天晚些的课算下一次', () => {
    const n = nextClassOf(snap, 'c2', MON, 500)
    expect(n?.date).toBe(MON)
    expect(n?.start).toBe(600)
  })
  it('当天上完则跳到之后的日期', () => {
    expect(nextClassOf(snap, 'c1', MON, 585)?.date).toBe(THU)
  })
  it('跳过假期与停课', () => {
    const withCancel: Snapshot = {
      ...snap,
      overrides: [{ id: 'o1', ruleId: 'r2', date: THU, kind: 'cancelled', createdAt: 0 }],
    }
    expect(nextClassOf(withCancel, 'c1', MON, 585)?.date).toBe('2026-09-14')
  })
  it('学期外找不到返回 null', () => {
    expect(nextClassOf(snap, 'c1', '2027-03-01', 480)).toBeNull()
  })
})

describe('suggestedDue', () => {
  it('默认落在下次上课的开始时刻', () => {
    expect(suggestedDue(snap, 'c1', MON, 585)).toEqual({ due: THU, dueMinutes: 600, beforeClass: true })
  })
  it('没有课程上下文时退回今晚 23:00', () => {
    expect(suggestedDue(snap, undefined, MON, 585)).toEqual({ due: MON, dueMinutes: 1380, beforeClass: false })
  })
})
