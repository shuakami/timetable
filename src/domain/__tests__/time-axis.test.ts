import { describe, expect, it } from 'vitest'
import type { TimeSlot } from '../types'
import { AXIS_GAP, AXIS_PAD_PER_HOUR, AXIS_ROW, AXIS_ROW_MIN, AXIS_WIDE_GAP, CARD_INSET, buildAxis, cardFit, cardNeed, fitLoc, gapLabel, rowHeights, textWidth } from '../time-axis'

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

describe('rowHeights', () => {
  const w = 40
  it('空行取下限，单节满卡取上限', () => {
    const rows = rowHeights(grid, [{ start: 600, end: 645, name: '概率论与数理统计', loc: '计科楼A302' }], w)
    const axis = buildAxis(grid, undefined, rows)
    const period = (i: number) => axis.segs.find((s) => s.kind === 'period' && s.index === i)!
    expect(period(1).y1 - period(1).y0).toBe(AXIS_ROW_MIN)
    const need = cardNeed(w, '概率论与数理统计', '计科楼A302')
    expect(period(3).y1 - period(3).y0).toBe(Math.ceil(need))
    expect(Math.ceil(need)).toBeLessThanOrEqual(AXIS_ROW)
    expect(need).toBeGreaterThan(AXIS_ROW - 2)
  })

  it('连堂课把需求摊到各节，后半节不被擑高，卡片总高仍够用', () => {
    const card = { start: 480, end: 580, name: '高等数学A', loc: '理教3楼 204' }
    const rows = rowHeights(grid, [card], w)
    expect(rows.get(1)).toBe(rows.get(2))
    expect(rows.get(1)!).toBeLessThan(AXIS_ROW_MIN)
    const axis = buildAxis(grid, undefined, rows)
    expect(axis.y(580) - axis.y(480)).toBe(2 * AXIS_ROW_MIN + AXIS_GAP)
    expect(axis.y(580) - axis.y(480)).toBeGreaterThanOrEqual(cardNeed(w, card.name, card.loc))
  })

  it('同一行取最高需求', () => {
    const rows = rowHeights(grid, [
      { start: 480, end: 525, name: '体育', loc: '操场' },
      { start: 480, end: 525, name: '马克思主义基本原理', loc: '教学楼B-301' },
    ], w)
    expect(rows.get(1)).toBe(Math.max(cardNeed(w, '体育', '操场'), cardNeed(w, '马克思主义基本原理', '教学楼B-301')))
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

describe('textWidth', () => {
  it('全角按 1em，ASCII 更窄', () => {
    expect(textWidth('理教', 10)).toBe(20)
    expect(textWidth('A1', 10)).toBeCloseTo(13.6)
    expect(textWidth('理教 204', 10)).toBeCloseTo(20 + 3 + 19.2)
  })
})

describe('cardFit', () => {
  const W = 39
  const ONE = AXIS_ROW - 2 * CARD_INSET
  const TWO = 2 * AXIS_ROW + AXIS_GAP - 2 * CARD_INSET

  it('一节课：窄列里四字课名折两行，地点仍能完整折两行', () => {
    expect(cardFit(ONE, W, '数据结构', '计科楼 A302')).toEqual({ nameLines: 2, locLines: 2, dense: false })
    expect(cardFit(ONE, W, '高等数学 A', '理教 204')).toEqual({ nameLines: 2, locLines: 2, dense: false })
    expect(cardFit(ONE, W, '数据结构')).toEqual({ nameLines: 2, locLines: 0, dense: false })
    expect(cardFit(ONE, W, '体育', '操场')).toEqual({ nameLines: 1, locLines: 1, dense: false })
  })

  it('地点排不下时先去空格，再从头部截、保留房号', () => {
    expect(fitLoc('理教 204', 2, W)).toBe('理教 204')
    expect(fitLoc('楼 A302', 1, W)).toBe('楼A302')
    expect(fitLoc('第二教学楼 B-301', 2, W)).toBe('…学楼B-301')
    expect(fitLoc('一号教学楼 A 302', 1, W)).toBe('…A302')
  })

  it('两节连上：足够高时课名、地点都不截断', () => {
    expect(cardFit(TWO, W, '马克思主义基本原理概论', '文科楼 105')).toEqual({ nameLines: 4, locLines: 2, dense: false })
  })

  it('越矮越少，太矮不放字', () => {
    expect(cardFit(30, W, '数据结构', '计科楼 A302')).toEqual({ nameLines: 1, locLines: 0, dense: false })
    expect(cardFit(20, W, '数据结构', '计科楼 A302')).toEqual({ nameLines: 1, locLines: 0, dense: true })
    expect(cardFit(12, W, '数据结构')).toBeNull()
  })
})
