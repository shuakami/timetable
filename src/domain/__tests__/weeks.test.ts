import { describe, expect, it } from 'vitest'
import { maskHasWeek, maskToWeeks, parsePeriodRange, parseWeekExpr, weeksToMask } from '../weeks'

describe('weeksToMask/maskToWeeks', () => {
  it('roundtrips', () => {
    const ws = [1, 2, 3, 8, 10, 12, 16]
    expect(maskToWeeks(weeksToMask(ws))).toEqual(ws)
  })
  it('maskHasWeek', () => {
    const m = weeksToMask([2, 4])
    expect(maskHasWeek(m, 2)).toBe(true)
    expect(maskHasWeek(m, 3)).toBe(false)
    expect(maskHasWeek(m, 0)).toBe(false)
  })
})

describe('parseWeekExpr', () => {
  it('range', () => expect(maskToWeeks(parseWeekExpr('1-16').mask)).toEqual([...Array(16)].map((_, i) => i + 1)))
  it('list + ranges', () => expect(maskToWeeks(parseWeekExpr('1-3,5,7-8').mask)).toEqual([1, 2, 3, 5, 7, 8]))
  it('odd weeks', () => expect(maskToWeeks(parseWeekExpr('1-8(单)').mask)).toEqual([1, 3, 5, 7]))
  it('even weeks', () => expect(maskToWeeks(parseWeekExpr('2-16双').mask)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]))
  it('fullwidth chars', () => expect(maskToWeeks(parseWeekExpr('１－３，５周').mask)).toEqual([1, 2, 3, 5]))
  it('single week', () => expect(maskToWeeks(parseWeekExpr('3').mask)).toEqual([3]))
  it('error on garbage', () => expect(parseWeekExpr('abc').error).toBeTruthy())
  it('error on empty', () => expect(parseWeekExpr('').error).toBe('EMPTY_WEEK_EXPR'))
  it('error on reversed range', () => expect(parseWeekExpr('8-3').error).toBeTruthy())
})

describe('parsePeriodRange', () => {
  it('dash', () => expect(parsePeriodRange('1-2')).toEqual({ start: 1, end: 2 }))
  it('with 节', () => expect(parsePeriodRange('3-4节')).toEqual({ start: 3, end: 4 }))
  it('第x,y节', () => expect(parsePeriodRange('第1,2节')).toEqual({ start: 1, end: 2 }))
  it('single', () => expect(parsePeriodRange('5')).toEqual({ start: 5, end: 5 }))
  it('garbage', () => expect(parsePeriodRange('x')).toBeNull())
})
