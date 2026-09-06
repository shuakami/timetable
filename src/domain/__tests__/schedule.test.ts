import { describe, expect, it } from 'vitest'
import type { TimeSlot } from '../types'
import {
  breakBefore, draftFromGrid, generateGrid, gridFromDraft, inferDuration, invalidPeriods,
  resetEnd, setCount, setDuration, setEnd, setStart,
} from '../schedule'

const grid: TimeSlot[] = [480, 535, 600, 655, 840, 895, 960, 1015, 1140, 1195].map((s, i) => ({ index: i + 1, start: s, end: s + 45 }))

describe('draft <-> grid', () => {
  it('标准时长取众数，不同时长的节记为覆盖', () => {
    const g = [...grid, { index: 11, start: 1250, end: 1285 }]
    expect(inferDuration(g)).toBe(45)
    const d = draftFromGrid(g)
    expect(d.duration).toBe(45)
    expect(d.ends.slice(0, 10).every((e) => e == null)).toBe(true)
    expect(d.ends[10]).toBe(1285)
    expect(gridFromDraft(d)).toEqual(g)
  })

  it('乱序 index 也按序号排', () => {
    const d = draftFromGrid([...grid].reverse())
    expect(d.starts[0]).toBe(480)
  })
})

describe('setCount', () => {
  it('加节沿用上一段课间，减节去掉末尾', () => {
    const d = draftFromGrid(grid)
    const d14 = setCount(d, 14)
    expect(d14.starts).toHaveLength(14)
    expect(d14.starts[10]).toBe(1240 + 10)
    expect(d14.starts[11]).toBe(1250 + 45 + 10)
    expect(setCount(d14, 8).starts).toEqual(grid.slice(0, 8).map((s) => s.start))
    expect(setCount(d, 100).starts).toHaveLength(20)
    expect(setCount(d, 1).starts).toHaveLength(4)
  })
})

describe('setDuration', () => {
  it('自动的下课跟着变，单独改过的不动；覆盖值恰等于新时长就回自动', () => {
    let d = draftFromGrid(grid)
    d = setEnd(d, 0, 480 + 50)
    d = setDuration(d, 40)
    expect(gridFromDraft(d)[1].end).toBe(535 + 40)
    expect(gridFromDraft(d)[0].end).toBe(530)
    d = setDuration(d, 50)
    expect(d.ends[0]).toBeNull()
    expect(setDuration(d, 7).duration).toBe(20)
  })
})

describe('setStart', () => {
  it('只动这一节 / 之后一起平移', () => {
    const d = draftFromGrid(grid)
    const one = setStart(d, 4, 870, false)
    expect(one.starts[4]).toBe(870)
    expect(one.starts[5]).toBe(895)
    const all = setStart(d, 4, 870, true)
    expect(all.starts.slice(4)).toEqual([870, 925, 990, 1045, 1170, 1225])
    expect(all.starts.slice(0, 4)).toEqual(d.starts.slice(0, 4))
  })

  it('平移时覆盖的下课也一起走', () => {
    let d = draftFromGrid(grid)
    d = setEnd(d, 5, 895 + 60)
    d = setStart(d, 4, 850, true)
    expect(d.ends[5]).toBe(905 + 60)
  })
})

describe('setEnd / resetEnd / breaks / invalid', () => {
  it('单独改下课与恢复', () => {
    let d = draftFromGrid(grid)
    d = setEnd(d, 2, 650)
    expect(d.ends[2]).toBe(650)
    expect(breakBefore(d, 3)).toBe(5)
    expect(breakBefore(d, 0)).toBe(0)
    d = resetEnd(d, 2)
    expect(d.ends[2]).toBeNull()
    expect(setEnd(d, 2, 645).ends[2]).toBeNull()
    expect(setEnd(d, 2, 590).ends[2]).toBe(601)
  })

  it('重叠 / 倒序标出', () => {
    let d = draftFromGrid(grid)
    expect(invalidPeriods(d)).toEqual([])
    d = setStart(d, 1, 500, false)
    expect(invalidPeriods(d)).toEqual([1])
  })
})

describe('generateGrid', () => {
  it('10 节 45 分钟 08:00 起：4 / 4 / 2', () => {
    const g = generateGrid(10, 45, 480)
    expect(g.map((s) => s.start)).toEqual([480, 535, 590, 645, 840, 895, 950, 1005, 1140, 1195])
  })

  it('14 节排不进紧凑方案就放宽午休截止，全程不重叠、不过 23:00', () => {
    const g = generateGrid(14, 45, 480)
    expect(g).toHaveLength(14)
    expect(g[0]).toEqual({ index: 1, start: 480, end: 525 })
    expect(g[4].start).toBe(700)
    expect(g[5].start).toBe(14 * 60)
    expect(g.some((s) => s.start === 19 * 60)).toBe(true)
    expect(g[13].end).toBeLessThanOrEqual(23 * 60)
    for (let i = 1; i < g.length; i++) expect(g[i].start).toBeGreaterThanOrEqual(g[i - 1].end)
  })

  it('16 节 40 分钟：紧凑方案放不下时逐级放宽，仍不重叠', () => {
    const g = generateGrid(16, 40, 480)
    expect(g).toHaveLength(16)
    for (let i = 1; i < g.length; i++) expect(g[i].start).toBeGreaterThanOrEqual(g[i - 1].end)
  })
})
