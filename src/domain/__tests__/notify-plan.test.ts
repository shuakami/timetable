import { describe, expect, it } from 'vitest'
import type { Prefs, Semester, Task, WidgetStyle } from '../types'
import { defaultPrefs } from '../types'
import { emptyState, hydrate } from '../store'
import type { Snapshot } from '../engine'
import { weeksToMask } from '../weeks'
import { atMinutes, inQuiet, planNotifications, stableId } from '../notify-plan'
import { buildWidgetData } from '../widget-data'

const sem: Semester = {
  id: 's1',
  name: '秋季学期',
  startDate: '2026-08-31', // 周一
  totalWeeks: 20,
  timeGrid: [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
    { index: 3, start: 600, end: 645 },
    { index: 4, start: 655, end: 700 },
  ],
  vacations: [],
  examWeeks: [19, 20],
}

const math = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#4F5BD5', identityKey: 'k1', hidden: false, source: 'import' as const }
const ds = { id: 'c2', semesterId: 's1', name: '数据结构', teacher: '陈敏', color: '#3E8E7E', identityKey: 'k2', hidden: false, source: 'import' as const }
const all = weeksToMask(Array.from({ length: 20 }, (_, i) => i + 1))

const snap: Snapshot = {
  semester: sem,
  courses: [math, ds],
  rules: [
    { id: 'r1', courseId: 'c1', weekday: 1, startPeriod: 1, endPeriod: 2, weeksMask: all, location: '教三 302' },
    { id: 'r2', courseId: 'c2', weekday: 1, startPeriod: 3, endPeriod: 4, weeksMask: all, location: '教一 201' },
  ],
  overrides: [],
  entries: [],
}

const prefs = (p: Partial<Prefs> = {}): Prefs => ({ ...defaultPrefs(), ...p })
const monday = new Date('2026-08-31T06:00:00')

describe('atMinutes / stableId / inQuiet', () => {
  it('atMinutes 折算到当天的本地时刻', () => {
    expect(new Date(atMinutes('2026-08-31', 8 * 60 + 30)).getHours()).toBe(8)
    expect(new Date(atMinutes('2026-08-31', 8 * 60 + 30)).getMinutes()).toBe(30)
  })
  it('stableId 同键同值、不同键不同值', () => {
    expect(stableId('class:a')).toBe(stableId('class:a'))
    expect(stableId('class:a')).not.toBe(stableId('class:b'))
    expect(stableId('class:a')).toBeGreaterThan(0)
  })
  it('inQuiet 跨零点', () => {
    const p = prefs({ quietStart: 23 * 60, quietEnd: 7 * 60 })
    expect(inQuiet(p, atMinutes('2026-08-31', 23 * 60 + 30))).toBe(true)
    expect(inQuiet(p, atMinutes('2026-08-31', 6 * 60))).toBe(true)
    expect(inQuiet(p, atMinutes('2026-08-31', 12 * 60))).toBe(false)
    expect(inQuiet(prefs({ quietStart: 0, quietEnd: 0 }), atMinutes('2026-08-31', 3 * 60))).toBe(false)
  })
})

describe('planNotifications', () => {
  it('第一节课用更早的提前量，其余用常规提前量', () => {
    const plan = planNotifications(snap, [], prefs(), monday, 1)
    const cls = plan.filter((n) => n.group === 'class')
    expect(cls).toHaveLength(2)
    // 08:00 - 40 分钟 = 07:20；10:00 - 15 分钟 = 09:45
    expect(new Date(cls[0].at).getHours() * 60 + new Date(cls[0].at).getMinutes()).toBe(7 * 60 + 20)
    expect(new Date(cls[1].at).getHours() * 60 + new Date(cls[1].at).getMinutes()).toBe(9 * 60 + 45)
    expect(cls[0].actionTypeId).toBe('class')
    expect(cls[0].ruleId).toBe('r1')
  })

  it('已经过去的时刻不排', () => {
    const plan = planNotifications(snap, [], prefs(), new Date('2026-08-31T09:50:00'), 1)
    expect(plan.filter((n) => n.group === 'class')).toHaveLength(0)
  })

  it('夜间不打扰区间里的通知被丢掉', () => {
    const plan = planNotifications(snap, [], prefs({ quietStart: 6 * 60, quietEnd: 8 * 60 }), monday, 1)
    expect(plan.filter((n) => n.group === 'class')).toHaveLength(1)
  })

  it('停课与静音的课不提醒', () => {
    const s: Snapshot = {
      ...snap,
      overrides: [
        { id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'cancelled', createdAt: 0 },
        { id: 'o2', ruleId: 'r2', date: '2026-08-31', kind: 'muted', createdAt: 0 },
      ],
    }
    expect(planNotifications(s, [], prefs(), monday, 1).filter((n) => n.group === 'class')).toHaveLength(0)
  })

  it('只提醒有变化的课', () => {
    const s: Snapshot = {
      ...snap,
      overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'moved', newStartPeriod: 3, newEndPeriod: 4, createdAt: 0 }],
    }
    const plan = planNotifications(s, [], prefs({ onlyChanged: true }), monday, 1)
    const cls = plan.filter((n) => n.group === 'class')
    expect(cls).toHaveLength(1)
    expect(cls[0].title).toContain('高等数学')
  })

  it('没有课也没有待办的一天不发摘要', () => {
    const plan = planNotifications(snap, [], prefs(), new Date('2026-09-01T06:00:00'), 1)
    expect(plan.filter((n) => n.group === 'summary')).toHaveLength(0)
  })

  it('有课的一天发一条摘要', () => {
    const plan = planNotifications(snap, [], prefs(), monday, 1)
    const sum = plan.filter((n) => n.group === 'summary')
    expect(sum).toHaveLength(1)
    expect(sum[0].title).toBe('今天 2 节课，08:00 开始')
  })

  it('作业排在前一晚，考试按配置的天数排', () => {
    const tasks: Task[] = [
      { id: 't1', title: '习题册 P41–P45', kind: 'homework', due: '2026-09-02', dueMinutes: 23 * 60, courseId: 'c1', done: false, createdAt: 0 },
      { id: 't2', title: '高数期中', kind: 'exam', due: '2026-09-04', dueMinutes: 14 * 60, courseId: 'c1', done: false, createdAt: 0 },
    ]
    const plan = planNotifications(snap, tasks, prefs(), monday)
    const hw = plan.find((n) => n.group === 'task')
    expect(hw).toBeTruthy()
    expect(new Date(hw!.at).getDate()).toBe(1)
    expect(new Date(hw!.at).getHours()).toBe(21)
    expect(hw!.taskId).toBe('t1')
    expect(hw!.actionTypeId).toBe('task')
    expect(plan.filter((n) => n.group === 'exam')).toHaveLength(2) // 3 天前与当天
  })

  it('已完成的待办不排', () => {
    const tasks: Task[] = [{ id: 't1', title: '习题册', kind: 'homework', due: '2026-09-02', done: true, createdAt: 0 }]
    expect(planNotifications(snap, tasks, prefs(), monday).filter((n) => n.group === 'task')).toHaveLength(0)
  })

  it('上课中静音：落在上课时间里的待办提醒被丢掉', () => {
    const tasks: Task[] = [{ id: 't1', title: '实验报告', kind: 'homework', due: '2026-09-08', dueMinutes: 12 * 60, done: false, createdAt: 0 }]
    const on = planNotifications(snap, tasks, prefs({ taskEveningAt: 10 * 60 + 30, muteInClass: true }), monday, 8)
    const off = planNotifications(snap, tasks, prefs({ taskEveningAt: 10 * 60 + 30, muteInClass: false }), monday, 8)
    expect(on.filter((n) => n.group === 'task')).toHaveLength(0)
    expect(off.filter((n) => n.group === 'task')).toHaveLength(1)
  })

  it('按时间排序', () => {
    const plan = planNotifications(snap, [], prefs(), monday, 7)
    const ats = plan.map((n) => n.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats)
  })
})

describe('buildWidgetData', () => {
  it('给出本周起 14 天', () => {
    const d = buildWidgetData(snap, 'today', monday)
    expect(d.style).toBe('today')
    expect(d.week).toBe(1)
    expect(d.days).toHaveLength(14)
    expect(d.days[0].date).toBe('2026-08-31')
    expect(d.days[0].items.map((i) => i.name)).toEqual(['高等数学', '数据结构'])
    expect(d.days[0].items[0].start).toBe('08:00')
  })

  it('每节带起止时刻，按开始时间排好序；停课的标出来', () => {
    const s: Snapshot = { ...snap, overrides: [{ id: 'o1', ruleId: 'r1', date: '2026-08-31', kind: 'cancelled', createdAt: 0 }] }
    const d = buildWidgetData(s, 'twoDays', new Date('2026-08-31T10:20:00'))
    const items = d.days[0].items
    expect(items.map((i) => i.cancelled)).toEqual([true, false])
    expect(items[1].startAt).toBe(atMinutes('2026-08-31', 600))
    expect(items[1].endAt).toBe(atMinutes('2026-08-31', 700))
    // 10:20 时：第一节已下课，第二节正在上 —— 小组件只应显示还没结束的
    const now = new Date('2026-08-31T10:20:00').getTime()
    expect(items.filter((i) => !i.cancelled && i.endAt > now).map((i) => i.name)).toEqual(['数据结构'])
  })

  it('旧偏好里的小组件样式不在可选项里时回到默认', () => {
    const s = hydrate({ ...emptyState(), prefs: { ...defaultPrefs(), widgetStyle: 'timeline' as WidgetStyle } })
    expect(s.prefs.widgetStyle).toBe(defaultPrefs().widgetStyle)
  })

  it('没有学期时给空数据', () => {
    const d = buildWidgetData(null, 'today', monday)
    expect(d.days).toHaveLength(0)
    expect(d.totalWeeks).toBe(0)
  })
})
