import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { parseCsv, normalize } from '../importer'
import { Store, hydrate, memoryPersistence, uid, type State } from '../store'
import { describeSemester } from '../ics'
import { guessSemesterName, semesterEnded, termEnd } from '../../app/semester'

const sem: Semester = {
  id: 's1', name: '2025–2026 学年 第 1 学期', startDate: '2025-09-01', totalWeeks: 20,
  timeGrid: [...Array(10)].map((_, i) => ({ index: i + 1, start: 480 + i * 55, end: 525 + i * 55 })),
  vacations: [], examWeeks: [],
}

const CSV = `课程,教师,地点,星期,节次,周次
高等数学,王立群,教三302,周一,1-2,1-16
大学英语,陈晓,外语楼105,二,3-4,1-8(单)`

function seeded() {
  const persistence = memoryPersistence()
  const store = new Store(persistence)
  store.setSemester(sem)
  const out = parseCsv(CSV, { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 })
  store.applyImport(normalize(out, sem).courses, {
    id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [],
  })
  return { store, persistence }
}

describe('semester lifecycle', () => {
  it('termEnd is the sunday of the last week', () => {
    expect(termEnd(sem)).toBe('2026-01-18')
    expect(semesterEnded(sem, '2026-01-18')).toBe(false)
    expect(semesterEnded(sem, '2026-01-19')).toBe(true)
  })

  it('names semesters by start month', () => {
    expect(guessSemesterName('2026-08-31')).toBe('2026–2027 学年 第 1 学期')
    expect(guessSemesterName('2026-02-23')).toBe('2025–2026 学年 第 2 学期')
    expect(guessSemesterName('2026-01-05')).toBe('2025–2026 学年 第 1 学期')
  })

  it('startSemester archives the old term with its courses and clears the timetable', async () => {
    const { store, persistence } = seeded()
    const next: Semester = { ...sem, id: 's2', name: '2026–2027 学年 第 1 学期', startDate: '2026-08-31' }
    store.startSemester(next)
    expect(store.state.semester?.id).toBe('s2')
    expect(store.state.courses).toHaveLength(0)
    expect(store.state.rules).toHaveLength(0)
    expect(store.state.archives).toHaveLength(1)
    expect(store.state.archives[0].semester.name).toBe(sem.name)
    expect(store.state.archives[0].courses).toHaveLength(2)
    expect(store.state.archives[0].rules[0].weeksMask).toBeTypeOf('bigint')

    await Promise.resolve()
    const back = persistence.load()!
    expect(back.archives[0].rules[0].weeksMask).toBeTypeOf('bigint')

    store.removeArchive('s1')
    expect(store.state.archives).toHaveLength(0)
  })

  it('empty semesters are not archived', () => {
    const store = new Store(memoryPersistence())
    store.setSemester(sem)
    store.startSemester({ ...sem, id: 's2' })
    expect(store.state.archives).toHaveLength(0)
  })

  it('hydrate defaults archives for old data', () => {
    const raw = { semester: sem, courses: [], rules: [], overrides: [], entries: [], batches: [], changes: [], userEditedCourseIds: [], savedRules: [], tasks: [], prefs: {} } as unknown as State
    expect(hydrate(raw).archives).toEqual([])
  })

  it('ics description carries semester metadata', () => {
    expect(describeSemester({ name: sem.name, startDate: sem.startDate, totalWeeks: 20, timeGrid: sem.timeGrid }, 12))
      .toBe('2025–2026 学年 第 1 学期 · 2025-09-01 开学 · 20 周 · 12 门课')
  })
})
