import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { parseCsv, parseJsonTable, normalize } from '../importer'
import { Store, memoryPersistence, uid } from '../store'
import { maskToWeeks } from '../weeks'

const sem: Semester = {
  id: 's1', name: '秋', startDate: '2026-08-31', totalWeeks: 20,
  timeGrid: [...Array(10)].map((_, i) => ({ index: i + 1, start: 480 + i * 55, end: 525 + i * 55 })),
  vacations: [], examWeeks: [],
}

const CSV = `课程,教师,地点,星期,节次,周次
高等数学,王立群,教三302,周一,1-2,1-16
大学英语,陈晓,外语楼105,二,3-4,1-8(单)
坏行,,,周八,1-2,1-16
数据结构,李慕华,教一201,3,5-6,2-16双`

describe('parseCsv', () => {
  it('parses valid rows and reports bad ones', () => {
    const out = parseCsv(CSV, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    expect(out.courses).toHaveLength(3)
    expect(out.diagnostics).toHaveLength(1)
    expect(out.diagnostics[0].code).toBe('UNPARSED_WEEKDAY')
    expect(out.courses[0]).toMatchObject({ name: '高等数学', weekday: 1, startPeriod: 1, endPeriod: 2 })
  })
})

describe('parseJsonTable', () => {
  it('parses common json timetable', () => {
    const out = parseJsonTable(JSON.stringify({
      courses: [{ name: '高数', teacher: '王', location: '教101', day: 1, startNode: 1, step: 2, weeks: [1, 2, 3] }],
    }))
    expect(out.courses).toHaveLength(1)
    expect(out.courses[0].endPeriod).toBe(2)
    expect(out.diagnostics).toHaveLength(0)
  })
  it('invalid json → diagnostic', () => {
    expect(parseJsonTable('{oops').diagnostics[0].code).toBe('INVALID_JSON')
  })
})

describe('normalize', () => {
  it('groups rules under same course, parses weeks', () => {
    const out = parseCsv(CSV, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    const { courses, diagnostics } = normalize(out, sem)
    expect(courses).toHaveLength(3)
    const eng = courses.find((c) => c.course.name === '大学英语')!
    expect(maskToWeeks(eng.rules[0].weeksMask)).toEqual([1, 3, 5, 7])
    expect(diagnostics.filter((d) => d.code !== 'UNPARSED_WEEKDAY')).toHaveLength(0)
  })
  it('rejects period out of grid', () => {
    const { courses, diagnostics } = normalize({
      courses: [{ name: 'x', weekday: 1, startPeriod: 11, endPeriod: 12, weeks: '1-2' }], diagnostics: [],
    }, sem)
    expect(courses).toHaveLength(0)
    expect(diagnostics[0].code).toBe('PERIOD_OUT_OF_GRID')
  })
})

describe('Store import merge', () => {
  function seed() {
    const store = new Store(memoryPersistence())
    store.setSemester(sem)
    const out = parseCsv(CSV, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    const { courses } = normalize(out, sem)
    store.applyImport(courses, {
      id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [],
    })
    return store
  }

  it('first import adds all', () => {
    const store = seed()
    expect(store.state.courses).toHaveLength(3)
    expect(store.state.rules).toHaveLength(3)
  })

  it('re-import keeps user-edited fields, marks disappeared', () => {
    const store = seed()
    const math = store.state.courses.find((c) => c.name === '高等数学')!
    store.editCourse(math.id, { teacher: '王立群（改）' })

    // 第二次导入：高数还在（教师原值），英语消失，新增大物
    const csv2 = `课程,教师,地点,星期,节次,周次
高等数学,王立群,教三302,周一,1-2,1-16
数据结构,李慕华,教一201,3,5-6,2-16双
大学物理,周敏,理科楼A203,四,1-2,1-16`
    const out = parseCsv(csv2, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    const { courses } = normalize(out, sem)

    const diff = store.previewImport(courses)
    expect(diff.added.map((c) => c.course.name)).toEqual(['大学物理'])
    expect(diff.removed.map((c) => c.name)).toEqual(['大学英语'])

    store.applyImport(courses, {
      id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [],
    })
    const math2 = store.state.courses.find((c) => c.name === '高等数学')!
    expect(math2.teacher).toBe('王立群（改）') // 用户改动被保护
    expect(math2.id).toBe(math.id) // 身份稳定
    const eng = store.state.courses.find((c) => c.name === '大学英语')!
    expect(eng.removedByImport).toBe(true)
    expect(eng.hidden).toBe(true) // 回收站，不物理删除
  })

  it('user entries survive import', () => {
    const store = seed()
    store.addEntry({ id: 'e1', semesterId: 's1', name: '自习', kind: 'study', weekday: 5, startPeriod: 1, endPeriod: 2, createdAt: 0 })
    const out = parseCsv(CSV, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    const { courses } = normalize(out, sem)
    store.applyImport(courses, {
      id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [],
    })
    expect(store.state.entries).toHaveLength(1)
  })

  it('rollback restores previous state', () => {
    const store = seed()
    const before = store.cloneState()
    const out = parseCsv('课程,教师,地点,星期,节次,周次\n新课,,,一,1-2,1-4', { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
    const { courses } = normalize(out, sem)
    store.applyImport(courses, {
      id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [],
    })
    store.rollbackLastImport(before)
    expect(store.state.courses.map((c) => c.name).sort()).toEqual(['大学英语', '数据结构', '高等数学'])
  })
})
