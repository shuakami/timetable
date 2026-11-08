import { describe, expect, it } from 'vitest'
import { emptyState, hydrate, type State } from '../store'
import { defaultPrefs } from '../types'

/* 提醒偏好 hydrate：classLead=0 是「不提醒」，不能被当成缺省值冲掉 */

const raw = (prefs: unknown): State => ({ ...emptyState(), prefs: prefs as State['prefs'] })

describe('hydratePrefs', () => {
  it('classLead=0（不提醒）保留', () => {
    expect(hydrate(raw({ ...defaultPrefs(), classLead: 0 })).prefs.classLead).toBe(0)
  })
  it('缺省与非法值回落默认 15 分钟', () => {
    expect(hydrate(raw({})).prefs.classLead).toBe(15)
    expect(hydrate(raw({ ...defaultPrefs(), classLead: -5 })).prefs.classLead).toBe(15)
    expect(hydrate(raw({ ...defaultPrefs(), classLead: 'x' })).prefs.classLead).toBe(15)
  })
})
