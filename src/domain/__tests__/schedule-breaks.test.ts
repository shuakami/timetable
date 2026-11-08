import { describe, expect, it } from 'vitest'
import type { TimeSlot } from '../types'
import {
  breakBefore, commonBreak, draftFromGrid, endOf, generateGrid, gridFromDraft,
  setCommonBreak, setGapBefore, DEFAULT_BREAK,
} from '../schedule'

/* 课间休息：统一课间与单段课间的推导 */

const uniform = draftFromGrid(generateGrid(10, 45, 480, 10))

describe('commonBreak', () => {
  it('取出现最多的普通课间，平局取短的', () => {
    expect(commonBreak(uniform)).toBe(10)
    // 3 节：间隔 10 / 20 各一次 → 平局取 10
    const tie = draftFromGrid([
      { index: 1, start: 480, end: 525 },
      { index: 2, start: 535, end: 580 },
      { index: 3, start: 600, end: 645 },
    ] as TimeSlot[])
    expect(commonBreak(tie)).toBe(10)
  })

  it('没有普通课间（全是长课间）返回 null', () => {
    const only = draftFromGrid([
      { index: 1, start: 480, end: 525 },
      { index: 2, start: 615, end: 660 },
      { index: 3, start: 750, end: 795 },
    ] as TimeSlot[])
    expect(commonBreak(only)).toBeNull()
  })
})

describe('setCommonBreak', () => {
  it('统一课间：相同间隔全改，长课间与单独错开的间隔不动', () => {
    // 先把第 3 节前的课间单独改成 30，和午休 / 晚饭一起作为「不该被统一的间隔」
    const custom = setGapBefore(uniform, 2, 30, true)
    const before = [...Array(custom.starts.length)].map((_, i) => breakBefore(custom, i))
    const after = setCommonBreak(custom, 5)
    for (let i = 1; i < after.starts.length; i++) {
      const g = breakBefore(after, i)
      const was = before[i]
      const expectG = was === 10 ? 5 : was
      expect(g, `第 ${i + 1} 节前`).toBe(expectG)
    }
    // 30 分的单独课间还在
    expect(breakBefore(after, 2)).toBe(30)
  })

  it('没有普通课间时原样返回', () => {
    const only = draftFromGrid([
      { index: 1, start: 480, end: 525 },
      { index: 2, start: 615, end: 660 },
    ] as TimeSlot[])
    expect(setCommonBreak(only, 5)).toBe(only)
  })
})

describe('setGapBefore', () => {
  it('平移模式：这一节和之后整体移动，后面的课间不变', () => {
    const i = 4 // 第 5 节前是午休长课间
    const lunch = breakBefore(uniform, i)
    expect(lunch).toBeGreaterThanOrEqual(60)
    const next = setGapBefore(uniform, i, 20, true)
    expect(breakBefore(next, i)).toBe(20)
    // 之后节次的相对间隔保持
    for (let k = i + 1; k < next.starts.length; k++) {
      expect(breakBefore(next, k)).toBe(breakBefore(uniform, k))
    }
    // 整体确实移动了
    expect(next.starts[i]).not.toBe(uniform.starts[i])
    expect(endOf(next, next.starts.length - 1)).toBeLessThanOrEqual(24 * 60)
  })

  it('只动这一节：下一节课间被吃掉一部分', () => {
    const i = 2
    const before = breakBefore(uniform, i + 1)
    const next = setGapBefore(uniform, i, 30, false)
    expect(breakBefore(next, i)).toBe(30)
    // 下一节开始没动 → 它前面的课间变了
    expect(next.starts[i + 1]).toBe(uniform.starts[i + 1])
    expect(breakBefore(next, i + 1)).not.toBe(before)
  })

  it('0 分钟课间 = 两节连上', () => {
    const next = setGapBefore(uniform, 1, 0, true)
    expect(breakBefore(next, 1)).toBe(0)
    expect(next.starts[1]).toBe(endOf(uniform, 0))
  })
})

describe('generateGrid 课间参数', () => {
  it('gap 直接决定相邻节间隔', () => {
    const g5 = generateGrid(6, 45, 480, 5)
    const g20 = generateGrid(6, 45, 480, 20)
    expect(g5[1].start - g5[0].end).toBe(5)
    expect(g20[1].start - g20[0].end).toBe(20)
    expect(DEFAULT_BREAK).toBe(10)
  })

  it('默认参数仍是 10 分钟', () => {
    const g = generateGrid(6, 45, 480)
    expect(g[1].start - g[0].end).toBe(10)
  })
})
