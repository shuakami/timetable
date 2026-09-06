import { describe, expect, it } from 'vitest'
import { defaultSemester, extendGrid, isDefaultGrid } from '../../app/semester'

describe('节次表来源', () => {
  it('出厂默认 10 节可被识别，改过任一节就不算默认', () => {
    const g = defaultSemester('2026-08-31').timeGrid
    expect(g).toHaveLength(10)
    expect(isDefaultGrid(g)).toBe(true)
    expect(isDefaultGrid(g.map((t, i) => (i === 4 ? { ...t, start: t.start + 5 } : t)))).toBe(false)
    expect(isDefaultGrid(g.slice(0, 9))).toBe(false)
  })

  it('课程到 13 节时按最后一节时长补齐，不改前面的节', () => {
    const g = defaultSemester('2026-08-31').timeGrid
    const x = extendGrid(g, 13)
    expect(x).toHaveLength(13)
    expect(x.slice(0, 10)).toEqual(g)
    expect(x[10]).toEqual({ index: 11, start: 1250, end: 1295 })
    expect(x[12].index).toBe(13)
    expect(extendGrid(g, 8)).toBe(g)
  })
})
