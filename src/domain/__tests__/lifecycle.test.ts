import { describe, expect, it } from 'vitest'
import type { Semester } from '../types'
import { defaultPrefs } from '../types'
import { parseCsv, normalize } from '../importer'
import { Store, STATE_VERSION, memoryPersistence, restoreState, serializeState, uid } from '../store'
import { occurrencesOn } from '../engine'
import { planCalendar } from '../calendar-plan'
import { buildWidgetData } from '../widget-data'

/* 端到端（领域层）：首次导入 → 改课 → 单次调课 → 再导入 → 重启 → 日历计划与小组件数据仍正确 */

const sem: Semester = {
  id: 's1', name: '秋', startDate: '2026-08-31', totalWeeks: 20,
  timeGrid: [...Array(10)].map((_, i) => ({ index: i + 1, start: 480 + i * 55, end: 525 + i * 55 })),
  vacations: [], examWeeks: [],
}
const MAP = { name: 0, teacher: 1, location: 2, weekday: 3, periods: 4, weeks: 5, skipRows: 1 }
const HEAD = '课程,教师,地点,星期,节次,周次\n'
const batch = () => ({ id: uid(), semesterId: 's1', ruleId: 'csv', ruleName: 'CSV', ruleVersion: '1', at: Date.now(), durationMs: 1, failed: 0, diagnostics: [] })
const imp = (store: Store, csv: string) => store.applyImport(normalize(parseCsv(HEAD + csv, MAP), sem).courses, batch())

describe('导入 → 修改 → 调课 → 再导入 → 重启', () => {
  it('课程改名、停课、调课在重导入和重启后都还在；日历和小组件按同一份事实算', async () => {
    const persistence = memoryPersistence()
    const store = new Store(persistence)
    store.setSemester(sem)
    imp(store, '高等数学,王立群,教三302,周一,1-2,1-16\n大学英语,陈晓,外语楼105,二,3-4,1-16')

    const math = store.state.courses.find((c) => c.name === '高等数学')!
    store.editCourse(math.id, { name: '高数（上）', color: '#112233' })
    const mon = store.state.rules.find((r) => r.courseId === math.id)!
    const eng = store.state.rules.find((r) => r.courseId !== math.id)!
    store.addOverride({ id: 'o1', ruleId: mon.id, date: '2026-09-07', kind: 'cancelled', createdAt: 0 })
    store.addOverride({ id: 'o2', ruleId: eng.id, date: '2026-09-08', kind: 'moved', newDate: '2026-09-10', newStartPeriod: 7, newEndPeriod: 8, createdAt: 0 })

    // 学校把高数换了教室、英语换了节次
    imp(store, '高等数学,王立群,教三401,周一,1-2,1-16\n大学英语,陈晓,外语楼105,二,5-6,1-16')

    // 重启：等微任务合批写完，再从持久化读回
    await Promise.resolve()
    const again = new Store(persistence)
    expect(again.state.version).toBe(STATE_VERSION)
    const snap = again.snapshot()!
    const course = snap.courses.find((c) => c.id === math.id)!
    expect(course.name).toBe('高数（上）') // 用户改的名字不被导入覆盖
    expect(course.color).toBe('#112233')
    expect(snap.rules.find((r) => r.courseId === math.id)?.location).toBe('教三401') // 排课事实跟学校
    expect(snap.rules.map((r) => r.id).sort()).toEqual([mon.id, eng.id].sort())
    expect(snap.overrides).toHaveLength(2)

    const d0907 = occurrencesOn(snap, '2026-09-07')
    expect(d0907.find((o) => o.name === '高数（上）')?.status).toBe('cancelled')
    expect(occurrencesOn(snap, '2026-09-08').filter((o) => o.name === '大学英语')).toHaveLength(0)
    const moved = occurrencesOn(snap, '2026-09-10').find((o) => o.name === '大学英语')!
    expect(moved).toMatchObject({ status: 'moved', startPeriod: 7, endPeriod: 8 })

    const events = planCalendar(snap, [], defaultPrefs(), new Date('2026-09-01T00:00:00Z'))
    const titles = events.map((e) => e.event.title)
    expect(titles.some((t) => t.includes('高数（上）') && t.includes('停课'))).toBe(true)
    expect(titles.some((t) => t.includes('大学英语') && t.includes('调课'))).toBe(true)
    expect(events.filter((e) => e.event.location === '教三401').length).toBeGreaterThan(0)
    expect(events.filter((e) => e.event.location === '教三302')).toHaveLength(0)

    const widget = buildWidgetData(snap, 'today', new Date('2026-09-07T00:00:00Z'))
    const day = widget.days.find((d) => d.date === '2026-09-07')!
    expect(day.items.find((i) => i.name === '高数（上）')).toMatchObject({ cancelled: true, loc: '教三401', color: '#112233' })
    expect(widget.days.find((d) => d.date === '2026-09-10')!.items.map((i) => i.name)).toContain('大学英语')
  })

  it('旧版本数据升级时先留底，再迁移', () => {
    const store = new Store(memoryPersistence())
    store.setSemester(sem)
    imp(store, '高等数学,王立群,教三302,周一,1-2,1-16')
    const legacy = JSON.parse(serializeState(store.state))
    delete legacy.version
    legacy.courses[0].identityKey = '高等数学|王立群|1|1'
    legacy.overrides = [{ id: 'x', ruleId: 'gone', date: '2026-09-07', kind: 'cancelled', createdAt: 0 }]
    const raw = JSON.stringify(legacy)

    const backups: [number, string][] = []
    const s = restoreState(raw, (json, v) => backups.push([v, json]))
    expect(backups).toEqual([[1, raw]])
    expect(s.version).toBe(STATE_VERSION)
    expect(s.courses[0].identityKey).toBe('高等数学|王立群')
    expect(s.overrides).toHaveLength(0)

    // 已是当前版本：不留底
    const again: [number, string][] = []
    restoreState(serializeState(s), (json, v) => again.push([v, json]))
    expect(again).toHaveLength(0)
  })
})
