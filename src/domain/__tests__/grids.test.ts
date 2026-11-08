import { describe, expect, it } from 'vitest'
import type { Semester, TimeSlot } from '../types'
import { dateOf, weekOf } from '../dates'
import { occurrencesOn, type Snapshot } from '../engine'
import { defaultGridRange, gridForDate, gridForWeek, maxPeriods, sanitizeGrids } from '../grids'
import { STATE_VERSION, memoryPersistence, restoreState, serializeState, Store } from '../store'
import { parseIcs } from '../importers/ics'
import { weeksToMask } from '../weeks'

/* 多作息制：周次区间解析、学期数据迁移 */

const slots = (base: number, n = 4): TimeSlot[] =>
  [...Array(n)].map((_, i) => ({ index: i + 1, start: base + i * 55, end: base + i * 55 + 45 }))

const sem: Semester = {
  id: 's1',
  name: '秋季学期',
  startDate: '2026-08-31', // 周一
  totalWeeks: 20,
  timeGrid: slots(480), // 默认 08:00 起
  grids: [
    { id: 'g-summer', name: '夏令时', fromWeek: 9, toWeek: 16, timeGrid: slots(510) }, // 晚 30 分钟
  ],
  vacations: [],
  examWeeks: [],
}

const course = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#4F5BD5', identityKey: 'k', hidden: false, source: 'import' as const }
const rule = { id: 'r1', courseId: 'c1', weekday: 1 as const, startPeriod: 1, endPeriod: 1, weeksMask: weeksToMask([...Array(16)].map((_, i) => i + 1)), location: '' }
const snap = (s: Semester = sem): Snapshot => ({ semester: s, courses: [course], rules: [rule], overrides: [], entries: [] })

describe('gridForWeek / gridForDate', () => {
  it('命中区间用那套作息制，其余周次回落默认表', () => {
    expect(gridForWeek(sem, 1)).toBe(sem.timeGrid)
    expect(gridForWeek(sem, 8)).toBe(sem.timeGrid)
    expect(gridForWeek(sem, 9)).toBe(sem.grids![0].timeGrid)
    expect(gridForWeek(sem, 16)).toBe(sem.grids![0].timeGrid)
    expect(gridForWeek(sem, 17)).toBe(sem.timeGrid)
    // 学期外周次也回落默认表
    expect(gridForWeek(sem, 0)).toBe(sem.timeGrid)
    expect(gridForWeek(sem, 25)).toBe(sem.timeGrid)
  })

  it('按日期解析：同一条规则不同周用不同钟点', () => {
    expect(weekOf(sem, '2026-10-26')).toBe(9)
    expect(dateOf(sem, 9, 1)).toBe('2026-10-26')
    expect(gridForDate(sem, '2026-08-31')).toBe(sem.timeGrid)
    expect(gridForDate(sem, '2026-10-26')).toBe(sem.grids![0].timeGrid)
  })

  it('没有 grids 时永远是默认表', () => {
    const single = { ...sem, grids: undefined }
    expect(gridForWeek(single, 9)).toBe(single.timeGrid)
    expect(gridForDate(single, '2026-10-26')).toBe(single.timeGrid)
  })
})

describe('occurrencesOn 按周解析作息制', () => {
  it('第 1 周和第 9 周同一节课用不同的钟点', () => {
    const w1 = occurrencesOn(snap(), '2026-08-31')[0]
    const w9 = occurrencesOn(snap(), '2026-10-26')[0]
    expect(w1.start).toBe(480)
    expect(w9.start).toBe(510)
    expect(w1.end).toBe(525)
    expect(w9.end).toBe(555)
  })

  it('调课到另一周时按目标日期的作息制给钟点', () => {
    const s = snap()
    s.overrides.push({ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'moved', newDate: '2026-10-27', createdAt: 0 })
    // 2026-10-27 是第 9 周周二；规则只有周一，这里直接验证 moved 落点的钟点
    const occ = occurrencesOn(s, '2026-10-27')[0]
    expect(occ.start).toBe(510)
  })
})

describe('sanitizeGrids / maxPeriods / defaultGridRange', () => {
  it('清洗：丢无效项、周次钳位换序、补 id', () => {
    const raw = [
      { id: 'a', name: '夏', fromWeek: 16, toWeek: 9, timeGrid: slots(600) }, // from>to → 交换
      { name: '坏', fromWeek: 1, toWeek: 5, timeGrid: [] }, // 空节次表 → 丢
      { name: 'x', timeGrid: slots(700) }, // 缺周次 → 丢
      null,
      'junk',
    ]
    const out = sanitizeGrids(raw, 20)!
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', fromWeek: 9, toWeek: 16 })
    expect(out[0].timeGrid[0].start).toBe(600)
  })

  it('非数组或清完为空返回 undefined', () => {
    expect(sanitizeGrids(undefined, 20)).toBeUndefined()
    expect(sanitizeGrids('x', 20)).toBeUndefined()
    expect(sanitizeGrids([{ name: 'x' }], 20)).toBeUndefined()
    expect(sanitizeGrids([], 20)).toBeUndefined()
  })

  it('周次钳到学期范围内', () => {
    const out = sanitizeGrids([{ id: 'a', fromWeek: -3, toWeek: 99, timeGrid: slots(600) }], 20)!
    expect(out[0]).toMatchObject({ fromWeek: 1, toWeek: 20 })
  })

  it('maxPeriods 取所有节次表的最大值', () => {
    expect(maxPeriods(sem)).toBe(4)
    const big = { ...sem, grids: [{ id: 'g', name: '', fromWeek: 1, toWeek: 2, timeGrid: slots(500, 9) }] }
    expect(maxPeriods(big)).toBe(9)
  })

  it('defaultGridRange 取第一段空档', () => {
    expect(defaultGridRange({ ...sem, grids: undefined })).toEqual([1, 20])
    const covered = { ...sem, grids: [{ id: 'a', name: '', fromWeek: 1, toWeek: 8, timeGrid: slots(500) }] }
    expect(defaultGridRange(covered)).toEqual([9, 20])
    const two = {
      ...sem,
      grids: [
        { id: 'a', name: '', fromWeek: 1, toWeek: 8, timeGrid: slots(500) },
        { id: 'b', name: '', fromWeek: 17, toWeek: 20, timeGrid: slots(500) },
      ],
    }
    expect(defaultGridRange(two)).toEqual([9, 16])
    const full = { ...sem, grids: [{ id: 'a', name: '', fromWeek: 1, toWeek: 20, timeGrid: slots(500) }] }
    expect(defaultGridRange(full)).toEqual([1, 20])
  })
})

describe('ICS 多作息制', () => {
  /* 冬令时 08:00/08:55 两节，夏令时（第 9–16 周）08:30/09:25 两节；浮动时间按墙钟，不受时区影响 */
  const winter: TimeSlot[] = [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
  ]
  const summer: TimeSlot[] = [
    { index: 1, start: 510, end: 555 },
    { index: 2, start: 565, end: 610 },
  ]
  const icsSem: Semester = {
    ...sem,
    timeGrid: winter,
    grids: [{ id: 'g-summer', name: '夏令时', fromWeek: 9, toWeek: 16, timeGrid: summer }],
  }
  const ve = (summary: string, dt: string, de: string) =>
    `BEGIN:VEVENT\r\nSUMMARY:${summary}\r\nDTSTART:${dt}\r\nDTEND:${de}\r\nEND:VEVENT\r\n`
  const file = (events: string) =>
    `BEGIN:VCALENDAR\r\nX-TT-SEMESTER:${JSON.stringify({ name: '秋', startDate: '2026-08-31', totalWeeks: 20, timeGrid: winter, grids: icsSem.grids })}\r\n${events}END:VCALENDAR\r\n`

  it('同一钟点按事件所在周的作息制对回不同节次', () => {
    const out = parseIcs(file(
      // 第 9 周周一 08:30–09:15 = 夏令时第 1 节
      ve('夏季课', '20261026T083000', '20261026T091500') +
      // 第 1 周周一同一钟点：冬令时里横跨第 1–2 节
      ve('冬季课', '20260831T083000', '20260831T091500'),
    ), icsSem)
    expect(out.diagnostics).toHaveLength(0)
    expect(out.courses).toHaveLength(2)
    expect(out.courses[0]).toMatchObject({ name: '夏季课', weekday: 1, startPeriod: 1, endPeriod: 1, weeks: '9' })
    expect(out.courses[1]).toMatchObject({ name: '冬季课', weekday: 1, startPeriod: 1, endPeriod: 2, weeks: '1' })
    // 文件里的作息制原样带出
    expect(out.grids).toHaveLength(1)
    expect(out.grids?.[0].timeGrid[0].start).toBe(510)
  })

  it('冬令时表里没有的钟点在夏令时周能认出来，在冬令时周报错', () => {
    const out = parseIcs(file(
      ve('夏下午', '20261028T100000', '20261028T104500') + // 第 9 周周三 10:00–10:45 = 夏令时第 2 节
      ve('冬下午', '20260902T100000', '20260902T104500'), // 第 1 周周三同一钟点：冬令时没有
    ), icsSem)
    expect(out.courses).toHaveLength(1)
    expect(out.courses[0]).toMatchObject({ name: '夏下午', startPeriod: 2, endPeriod: 2, weeks: '9' })
    expect(out.diagnostics.some((d) => d.code === 'TIME_OUT_OF_GRID')).toBe(true)
  })
})

describe('持久化迁移', () => {
  it('v2 数据升级到 v3 先留底；坏 grids 被清洗，学期与往期学期都处理', async () => {
    const store = new Store(memoryPersistence())
    store.setSemester(sem)
    await Promise.resolve()
    const legacy = JSON.parse(serializeState(store.state))
    legacy.version = 2
    legacy.semester.grids = [
      { id: 'g-x', name: '错位', fromWeek: 18, toWeek: 12, timeGrid: slots(700) },
      { name: '空', fromWeek: 1, toWeek: 3, timeGrid: [] },
    ]
    legacy.archives = [
      {
        semester: { ...sem, id: 'old', grids: [{ id: 'g-old', name: '旧', fromWeek: 2, toWeek: 6, timeGrid: [{ index: 1, start: 999, end: 100 }] }] },
        courses: [], rules: [], overrides: [], entries: [], archivedAt: 0,
      },
    ]
    const raw = JSON.stringify(legacy)

    const backups: [number, string][] = []
    const s = restoreState(raw, (json, v) => backups.push([v, json]))
    expect(backups).toEqual([[2, raw]])
    expect(s.version).toBe(STATE_VERSION)

    // 学期：from>to 已交换，空表条目被丢
    expect(s.semester?.grids).toHaveLength(1)
    expect(s.semester?.grids?.[0]).toMatchObject({ id: 'g-x', fromWeek: 12, toWeek: 18 })
    // 往期学期：start>end 的坏节次被过滤后整条丢弃
    expect(s.archives[0].semester.grids).toBeUndefined()

    // 已是当前版本不再留底
    const again: [number, string][] = []
    restoreState(serializeState(s), (json, v) => again.push([v, json]))
    expect(again).toHaveLength(0)
  })
})
