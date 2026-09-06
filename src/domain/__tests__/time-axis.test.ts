import { describe, expect, it } from 'vitest'
import type { TimeSlot } from '../types'
import { AXIS_GAP, AXIS_PAD_PER_HOUR, AXIS_ROW, AXIS_WIDE_GAP, buildAxis, cardFit, gapLabel } from '../time-axis'

const grid: TimeSlot[] = [480, 535, 600, 655, 840, 895, 960, 1015, 1140, 1195].map((s, i) => ({ index: i + 1, start: s, end: s + 45 }))

describe('buildAxis', () => {
  it('每节一行，短课间窄带，长课间带标签', () => {
    const axis = buildAxis(grid)
    const periods = axis.segs.filter((s) => s.kind === 'period')
    expect(periods).toHaveLength(10)
    for (const p of periods) expect(p.y1 - p.y0).toBe(AXIS_ROW)
    const gaps = axis.segs.filter((s) => s.kind === 'gap')
    expect(gaps.filter((g) => g.label)).toHaveLength(2)
    expect(gaps.find((g) => g.t0 === 700)).toMatchObject({ label: '午休 2 小时 20 分' })
    expect(gaps.find((g) => g.t0 === 1060)).toMatchObject({ label: '晚饭 1 小时 20 分' })
    expect(gaps.find((g) => g.t0 === 525)!.y1 - gaps.find((g) => g.t0 === 525)!.y0).toBe(AXIS_GAP)
    expect(axis.height).toBe(10 * AXIS_ROW + 7 * AXIS_GAP + 2 * AXIS_WIDE_GAP)
  })

  it('y 单调递增，节次边界严格对齐', () => {
    const axis = buildAxis(grid)
    expect(axis.y(480)).toBe(0)
    expect(axis.y(525)).toBe(AXIS_ROW)
    expect(axis.y(535)).toBe(AXIS_ROW + AXIS_GAP)
    let prev = -Infinity
    for (let t = 420; t <= 1300; t += 5) {
      const y = axis.y(t)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    /* 两节连上 = 两行 + 一条窄带 */
    expect(axis.y(580) - axis.y(480)).toBe(2 * AXIS_ROW + AXIS_GAP)
  })

  it('节次之外的早课 / 晚自习按真实时长线性延伸', () => {
    const axis = buildAxis(grid, { start: 7 * 60, end: 22 * 60 })
    expect(axis.segs[0]).toMatchObject({ kind: 'pad', t0: 420, t1: 480 })
    expect(axis.y(480)).toBe(AXIS_PAD_PER_HOUR)
    const last = axis.segs[axis.segs.length - 1]
    expect(last).toMatchObject({ kind: 'pad', t0: 1240, t1: 1320 })
    expect(axis.y(1320) - axis.y(1240)).toBeCloseTo((80 / 60) * AXIS_PAD_PER_HOUR)
    /* 没有 span 时不补边 */
    expect(buildAxis(grid).segs[0].kind).toBe('period')
  })

  it('14 节、乱序、重叠的作息也能建轴', () => {
    const g14: TimeSlot[] = Array.from({ length: 14 }, (_, i) => ({ index: i + 1, start: 480 + i * 50, end: 480 + i * 50 + 45 }))
    const axis = buildAxis([...g14].reverse())
    expect(axis.segs.filter((s) => s.kind === 'period').map((s) => s.index)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    const overlap = buildAxis([{ index: 1, start: 480, end: 530 }, { index: 2, start: 520, end: 570 }])
    expect(overlap.segs.map((s) => [s.t0, s.t1])).toEqual([[480, 530], [530, 570]])
    expect(buildAxis([]).height).toBe(12 * AXIS_PAD_PER_HOUR)
  })
})

describe('gapLabel', () => {
  it('按时段取名', () => {
    expect(gapLabel(700, 140)).toBe('午休 2 小时 20 分')
    expect(gapLabel(1060, 80)).toBe('晚饭 1 小时 20 分')
    expect(gapLabel(1230, 60)).toBe('休息 1 小时')
    expect(gapLabel(1230, 50)).toBe('休息 50 分')
  })
})

describe('cardFit', () => {
  it('一节课的卡片能放两行课名 + 地点；越矮越少，太矮不放字', () => {
    expect(cardFit(AXIS_ROW - 2)).toEqual({ lines: 2, loc: true, dense: false })
    expect(cardFit(48)).toEqual({ lines: 1, loc: true, dense: false })
    expect(cardFit(30)).toEqual({ lines: 1, loc: false, dense: false })
    expect(cardFit(20)).toEqual({ lines: 1, loc: false, dense: true })
    expect(cardFit(12)).toBeNull()
  })

  it('半宽卡不放地点，课名按高度多排几行', () => {
    expect(cardFit(2 * AXIS_ROW + AXIS_GAP - 2, true)).toEqual({ lines: 6, loc: false, dense: false })
    expect(cardFit(AXIS_ROW - 2, true)).toEqual({ lines: 3, loc: false, dense: false })
    expect(cardFit(22, true)).toEqual({ lines: 1, loc: false, dense: true })
    expect(cardFit(10, true)).toBeNull()
  })
})
