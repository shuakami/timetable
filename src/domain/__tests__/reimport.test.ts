import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { parseCsv, normalize, pairRules, matchImport } from '../importer'
import { Store, STATE_VERSION, hydrate, memoryPersistence, uid, type State } from '../store'
import { occurrencesOn } from '../engine'
import { weeksToMask } from '../weeks'

/* 重导入回归：规则 id 沿用、Override 不失联、排课变动算「调整」而不是「消失+新增」 */

const sem: Semester = {
  id: 's1', name: '秋', startDate: '2026-08-31', totalWeeks: 20,
  timeGrid: [...Array(10)].map((_, i) => ({ index: i + 1, start: 480 + i * 55, end: 525 + i * 55 })),
  vacations: [], examWeeks: [],
}
const MAP = { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 }
const HEAD = '课程,教师,地点,星期,节次,周次\n'
const batch = () => ({ id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [] })

function seed(csv: string) {
  const store = new Store(memoryPersistence())
  store.setSemester(sem)
  store.applyImport(normalize(parseCsv(HEAD + csv, MAP), sem).courses, batch())
  return store
}
const imp = (store: Store, csv: string) => {
  const nc = normalize(parseCsv(HEAD + csv, MAP), sem).courses
  const diff = store.previewImport(nc)
  store.applyImport(nc, batch())
  return diff
}

const MATH = '高等数学,王立群,教三302,周一,1-2,1-16'
const MATH2 = '高等数学,王立群,教三302,周三,5-6,1-16'
const ENG = '大学英语,陈晓,外语楼105,二,3-4,1-16'

describe('重导入：规则 id 与 Override', () => {
  it('同样的课再导一次，规则 id 不变，停课仍然生效', () => {
    const store = seed(`${MATH}\n${MATH2}\n${ENG}`)
    const ids = store.state.rules.map((r) => r.id).sort()
    const mon = store.state.rules.find((r) => r.weekday === 1)!
    store.addOverride({ id: 'o1', ruleId: mon.id, date: '2026-09-07', kind: 'cancelled', createdAt: 0 })

    const diff = imp(store, `${MATH}\n${MATH2}\n${ENG}`)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed).toHaveLength(0)
    expect(diff.unchanged).toBe(2)
    expect(store.state.rules.map((r) => r.id).sort()).toEqual(ids)
    expect(store.state.overrides).toHaveLength(1)
    const occ = occurrencesOn(store.snapshot()!, '2026-09-07')
    expect(occ.find((o) => o.name === '高等数学')?.status).toBe('cancelled')
  })

  it('课换了星期：算调整，不算消失+新增；课程 id 不变，规则换新 id，旧日子的 Override 不再挂着', () => {
    const store = seed(`${MATH}\n${ENG}`)
    const math = store.state.courses.find((c) => c.name === '高等数学')!
    const rule = store.state.rules.find((r) => r.courseId === math.id)!
    store.addOverride({ id: 'o1', ruleId: rule.id, date: '2026-09-07', kind: 'moved', newDate: '2026-09-08', createdAt: 0 })

    const diff = imp(store, `${MATH2}\n${ENG}`)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed.map((c) => c.name)).toEqual(['高等数学'])
    expect(diff.unchanged).toBe(1)
    const math2 = store.state.courses.find((c) => c.name === '高等数学')!
    expect(math2.id).toBe(math.id)
    expect(math2.removedByImport).toBeFalsy()
    const rule2 = store.state.rules.find((r) => r.courseId === math.id)!
    expect(rule2.id).not.toBe(rule.id)
    expect(rule2.weekday).toBe(3)
    expect(store.state.overrides).toHaveLength(0)
    // 不会在 9/8 冒出一节“调过来”的幽灵课
    expect(occurrencesOn(store.snapshot()!, '2026-09-08').filter((o) => o.name === '高等数学')).toHaveLength(0)
  })

  it('课同一天换节次或教室：规则沿用 id，那天的停课还在', () => {
    const store = seed(`${MATH}\n${ENG}`)
    const rule = store.state.rules.find((r) => r.weekday === 1)!
    store.addOverride({ id: 'o1', ruleId: rule.id, date: '2026-09-07', kind: 'cancelled', createdAt: 0 })
    const diff = imp(store, `高等数学,王立群,教三305,周一,3-4,1-16\n${ENG}`)
    expect(diff.changed.map((c) => c.name)).toEqual(['高等数学'])
    const rule2 = store.state.rules.find((r) => r.weekday === 1)!
    expect(rule2.id).toBe(rule.id)
    expect(rule2).toMatchObject({ startPeriod: 3, endPeriod: 4, location: '教三305' })
    expect(occurrencesOn(store.snapshot()!, '2026-09-07').find((o) => o.name === '高等数学')?.status).toBe('cancelled')
  })

  it('一门课两条规则，删掉其中一条：留下的沿用 id，删掉那条的 Override 一起清掉', () => {
    const store = seed(`${MATH}\n${MATH2}`)
    const mon = store.state.rules.find((r) => r.weekday === 1)!
    const wed = store.state.rules.find((r) => r.weekday === 3)!
    store.addOverride({ id: 'o1', ruleId: mon.id, date: '2026-09-07', kind: 'cancelled', createdAt: 0 })
    store.addOverride({ id: 'o2', ruleId: wed.id, date: '2026-09-09', kind: 'leave', createdAt: 0 })

    imp(store, MATH2)
    expect(store.state.rules).toHaveLength(1)
    expect(store.state.rules[0].id).toBe(wed.id)
    expect(store.state.overrides.map((o) => o.id)).toEqual(['o2'])
  })

  it('课消失进回收站：规则和 Override 原样保留，再出现时接回来', () => {
    const store = seed(`${MATH}\n${ENG}`)
    const eng = store.state.rules.find((r) => r.weekday === 2)!
    store.addOverride({ id: 'o1', ruleId: eng.id, date: '2026-09-08', kind: 'cancelled', createdAt: 0 })

    const d1 = imp(store, MATH)
    expect(d1.removed.map((c) => c.name)).toEqual(['大学英语'])
    expect(store.state.rules.find((r) => r.id === eng.id)).toBeTruthy()
    expect(store.state.overrides).toHaveLength(1)

    const d2 = imp(store, `${MATH}\n${ENG}`)
    expect(d2.added).toHaveLength(0)
    expect(d2.changed.map((c) => c.name)).toEqual(['大学英语'])
    const back = store.state.courses.find((c) => c.name === '大学英语')!
    expect(back.removedByImport).toBe(false)
    expect(store.state.rules.find((r) => r.courseId === back.id)!.id).toBe(eng.id)
    expect(occurrencesOn(store.snapshot()!, '2026-09-08').find((o) => o.name === '大学英语')?.status).toBe('cancelled')
  })

  it('教师名变了但课名唯一：按课名接上，不算新增', () => {
    const store = seed(`${MATH}\n${ENG}`)
    const math = store.state.courses.find((c) => c.name === '高等数学')!
    const diff = imp(store, `高等数学,王立群（教授）,教三302,周一,1-2,1-16\n${ENG}`)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed.map((c) => c.id)).toEqual([math.id])
    const math2 = store.state.courses.find((c) => c.name === '高等数学')!
    expect(math2.id).toBe(math.id)
    expect(math2.teacher).toBe('王立群（教授）')
  })

  it('同名课多个老师都换了：对不上就不瞎接', () => {
    const store = seed('体育,甲,操场,一,1-2,1-16\n体育,乙,操场,二,1-2,1-16')
    const diff = imp(store, '体育,丙,操场,一,1-2,1-16\n体育,丁,操场,二,1-2,1-16')
    expect(diff.added.map((c) => c.course.teacher).sort()).toEqual(['丁', '丙'])
    expect(diff.removed.map((c) => c.teacher).sort()).toEqual(['乙', '甲'])
  })

  it('用户改过的课：老师变化不算调整，排课变化仍算', () => {
    const store = seed(`${MATH}\n${ENG}`)
    const math = store.state.courses.find((c) => c.name === '高等数学')!
    store.editCourse(math.id, { teacher: '王老师' })
    const d1 = store.previewImport(normalize(parseCsv(HEAD + MATH, MAP), sem).courses)
    expect(d1.changed).toHaveLength(0)
    expect(d1.protectedKept.map((c) => c.id)).toEqual([math.id])
    const d2 = store.previewImport(normalize(parseCsv(HEAD + MATH2, MAP), sem).courses)
    expect(d2.changed.map((c) => c.id)).toEqual([math.id])
    expect(d2.unchanged).toBe(0)
  })
})

describe('pairRules', () => {
  const r = (id: string, weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7, s: number, e: number) => ({ id, courseId: 'c', weekday, startPeriod: s, endPeriod: e, weeksMask: weeksToMask([1]) })
  it('先同节次，再同起始，再同星期最近的；一条旧规则只接一次', () => {
    const old = [r('a', 1, 1, 2), r('b', 1, 5, 6), r('c', 3, 1, 2)]
    const nu = [r('x', 1, 5, 7), r('y', 1, 1, 2), r('z', 3, 7, 8), r('w', 5, 1, 2)]
    const m = pairRules(old, nu)
    expect(m.get(nu[1])?.id).toBe('a')
    expect(m.get(nu[0])?.id).toBe('b')
    expect(m.get(nu[2])?.id).toBe('c')
    expect(m.has(nu[3])).toBe(false)
  })
})

describe('matchImport', () => {
  it('身份键优先，课名兜底只在两边都唯一时用', () => {
    const c = (id: string, key: string) => ({ id, semesterId: 's1', name: id, color: '#000', identityKey: key, hidden: false, source: 'import' as const })
    const n = (key: string) => ({ course: { name: key, color: '#000', identityKey: key, hidden: false, source: 'import' as const }, rules: [] })
    const ex = [c('a', '高数|甲'), c('b', '英语|乙'), c('c', '英语|丙')]
    const inc = [n('高数|丁'), n('英语|乙'), n('英语|戊')]
    const m = matchImport(ex, inc)
    expect(m.get(inc[0])?.id).toBe('a') // 唯一同名，接上
    expect(m.get(inc[1])?.id).toBe('b') // 键相同
    expect(m.get(inc[2])?.id).toBe('c') // 键对完后两边各剩一条同名的，接上
  })
  it('同名剩下不止一条时不接', () => {
    const c = (id: string, key: string) => ({ id, semesterId: 's1', name: id, color: '#000', identityKey: key, hidden: false, source: 'import' as const })
    const n = (key: string) => ({ course: { name: key, color: '#000', identityKey: key, hidden: false, source: 'import' as const }, rules: [] })
    const m = matchImport([c('a', '英语|乙'), c('b', '英语|丙')], [n('英语|戊')])
    expect(m.size).toBe(0)
  })
})

describe('hydrate 迁移', () => {
  it('v1 身份键去掉 星期|节次；指向不存在规则的 Override 清掉', () => {
    const raw = {
      semester: sem, archives: [], entries: [], batches: [], changes: [], userEditedCourseIds: [], savedRules: [], tasks: [], prefs: {},
      courses: [
        { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#000', identityKey: '高等数学|王立群|1|1', hidden: false, source: 'import' },
        { id: 'c2', semesterId: 's1', name: '英语', color: '#000', identityKey: '英语||2|3', hidden: false, source: 'import' },
      ],
      rules: [{ id: 'r1', courseId: 'c1', weekday: 1, startPeriod: 1, endPeriod: 2, weeksMask: '3' }],
      overrides: [
        { id: 'o1', ruleId: 'r1', date: '2026-09-07', kind: 'cancelled', createdAt: 0 },
        { id: 'o2', ruleId: 'gone', date: '2026-09-07', kind: 'cancelled', createdAt: 0 },
      ],
    } as unknown as State
    const s = hydrate(raw)
    expect(s.courses[0].identityKey).toBe('高等数学|王立群')
    expect(s.courses[1].identityKey).toBe('英语|')
    expect(s.overrides.map((o) => o.id)).toEqual(['o1'])
    expect(s.version).toBe(STATE_VERSION)
  })
  it('已是当前版本的键不再改', () => {
    const raw = {
      version: STATE_VERSION, semester: null, archives: [], entries: [], batches: [], changes: [], userEditedCourseIds: [], savedRules: [], tasks: [], prefs: {},
      courses: [{ id: 'c1', semesterId: 's1', name: 'x', color: '#000', identityKey: '数学分析|1|2', hidden: false, source: 'import' }],
      rules: [], overrides: [],
    } as unknown as State
    expect(hydrate(raw).courses[0].identityKey).toBe('数学分析|1|2')
  })
})
