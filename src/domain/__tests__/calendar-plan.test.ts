import { describe, expect, it } from 'vitest'
import type { Semester, Task } from '../types'
import { defaultPrefs } from '../types'
import type { Snapshot } from '../engine'
import { weeksToMask } from '../weeks'
import { EXAM_CALENDAR, TASK_CALENDAR, WEEK_CALENDAR, calendarsFor, courseCalendar, eventHash, planCalendar, summarize, type DesiredEvent } from '../calendar-plan'

/** 课程/作业/考试事件（不含每周一的「第 N 周」） */
const noWeeks = (ev: DesiredEvent[]) => ev.filter((e) => e.kind !== 'week')

const sem: Semester = {
  id: 's1',
  name: '秋季学期',
  startDate: '2026-08-31', // 周一
  totalWeeks: 8,
  timeGrid: [
    { index: 1, start: 480, end: 525 },
    { index: 2, start: 535, end: 580 },
    { index: 3, start: 600, end: 645 },
    { index: 4, start: 655, end: 700 },
  ],
  vacations: [],
  examWeeks: [],
}

function snap(partial: Partial<Snapshot> = {}): Snapshot {
  return { semester: sem, courses: [], rules: [], overrides: [], entries: [], ...partial }
}

const course = { id: 'c1', semesterId: 's1', name: '高等数学', teacher: '王立群', color: '#4F5BD5', identityKey: 'k', hidden: false, source: 'import' as const }
const weekly = { id: 'r1', courseId: 'c1', weekday: 1 as const, startPeriod: 1, endPeriod: 2, weeksMask: weeksToMask([1, 2, 3, 4, 5, 6, 7, 8]), location: '教三 302' }
const now = new Date('2026-09-01T12:00:00')
const prefs = defaultPrefs()

describe('课程', () => {
  it('每周同一时间合成一条重复事件', () => {
    const ev = noWeeks(planCalendar(snap({ courses: [course], rules: [weekly] }), [], prefs, now))
    expect(ev).toHaveLength(1)
    const e = ev[0]
    expect(e.kind).toBe('course')
    expect(e.event.title).toBe('高等数学')
    expect(e.event.location).toBe('教三 302')
    expect(e.event.description).toBe('王立群')
    expect(e.calendar).toBe(courseCalendar('c1'))
    expect(e.event.rrule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8')
    expect(e.event.duration).toBe('PT100M')
    expect(e.event.exdate).toBeUndefined()
    expect(e.reminders).toEqual([15, 30]) // 08:00 是早课：课前 15 + 早课 30
  })

  it('缺的周用 EXDATE 挖掉；单双周用 INTERVAL=2', () => {
    const gap = { ...weekly, weeksMask: weeksToMask([1, 2, 4, 5, 6, 7, 8]) }
    const [e] = planCalendar(snap({ courses: [course], rules: [gap] }), [], prefs, now)
    expect(e.event.rrule).toContain('COUNT=8')
    expect(e.event.exdate?.split(',')).toHaveLength(1)

    const odd = { ...weekly, weeksMask: weeksToMask([1, 3, 5, 7]) }
    const [o] = planCalendar(snap({ courses: [course], rules: [odd] }), [], prefs, now)
    expect(o.event.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4')
    expect(o.event.exdate).toBeUndefined()
  })

  it('次数太少直接写单次事件', () => {
    const few = { ...weekly, weeksMask: weeksToMask([1, 2]) }
    const ev = noWeeks(planCalendar(snap({ courses: [course], rules: [few] }), [], prefs, now))
    expect(ev).toHaveLength(2)
    expect(ev.every((e) => !e.event.rrule && e.event.end != null)).toBe(true)
  })

  it('停课挖掉、调课单独一条、静音这一次没有提醒', () => {
    const s = snap({
      courses: [course],
      rules: [weekly],
      overrides: [
        { id: 'o1', kind: 'cancelled', ruleId: 'r1', date: '2026-09-07', createdAt: 0 },
        { id: 'o2', kind: 'moved', ruleId: 'r1', date: '2026-09-14', newDate: '2026-09-16', newStartPeriod: 3, newEndPeriod: 4, createdAt: 0 },
        { id: 'o3', kind: 'muted', ruleId: 'r1', date: '2026-09-21', createdAt: 0 },
      ],
    })
    const ev = planCalendar(s, [], prefs, now)
    const series = ev.find((e) => e.key === 'c:r1')!
    expect(series.event.exdate?.split(',')).toHaveLength(3)
    const moved = ev.find((e) => e.key.startsWith('mv:'))!
    expect(moved.event.start).toBe(new Date('2026-09-16T10:00:00').getTime())
    expect(moved.event.title).toBe('高等数学（调课）')
    const muted = ev.find((e) => e.key.startsWith('mu:'))!
    expect(muted.reminders).toEqual([])
    // 停课的那次留在日历里：原时间、标题带（停课）、不提醒不占时间
    const off = ev.find((e) => e.key.startsWith('x:'))!
    expect(off.event.title).toBe('高等数学（停课）')
    expect(off.event.start).toBe(new Date('2026-09-07T08:00:00').getTime())
    expect(off.event.cancelled).toBe(true)
    expect(off.event.busy).toBe(false)
    expect(off.reminders).toEqual([])
    expect(off.calendar).toBe(courseCalendar('c1'))
    expect(summarize(ev).courses).toBe(1)
  })

  it('老师电话单独一行写进描述', () => {
    const c = { ...course, teacherPhone: '13800138000' }
    const [e] = planCalendar(snap({ courses: [c], rules: [weekly] }), [], prefs, now)
    expect(e.event.description).toBe('王立群\n13800138000')
  })

  it('晚课不加早课提醒', () => {
    const late = { ...weekly, startPeriod: 3, endPeriod: 4 }
    const [e] = planCalendar(snap({ courses: [course], rules: [late] }), [], prefs, now)
    expect(e.reminders).toEqual([15])
  })

  it('每周一一条全天「第 N 周」，进上课那本日历', () => {
    const weeks = planCalendar(snap(), [], prefs, now).filter((e) => e.kind === 'week')
    expect(weeks).toHaveLength(8)
    expect(weeks[0].event).toMatchObject({ title: '第 1 周', allDay: true, start: Date.UTC(2026, 7, 31) })
    expect(weeks[0].reminders).toEqual([])
    expect(weeks[0].calendar).toBe(WEEK_CALENDAR)
  })

  it('每门课一本日历、用课程颜色；作业、考试、周次各一本', () => {
    const c2 = { ...course, id: 'c2', name: '线性代数', color: '#B98A2F' }
    const r2 = { ...weekly, id: 'r2', courseId: 'c2', weekday: 3 as const }
    const ev = planCalendar(snap({ courses: [course, c2], rules: [weekly, r2] }), [{ ...base, due: '2026-09-10' }, { ...base, id: 'x', kind: 'exam', due: '2026-09-11' }], prefs, now)
    const cals = calendarsFor(ev, snap({ courses: [course, c2] }))
    expect(cals.map((c) => [c.slug, c.name, c.color])).toEqual([
      [courseCalendar('c1'), '课程表 高等数学', '#4F5BD5'],
      [courseCalendar('c2'), '课程表 线性代数', '#B98A2F'],
      [WEEK_CALENDAR, '课程表 周次', undefined],
      [TASK_CALENDAR, '课程表 作业', undefined],
      [EXAM_CALENDAR, '课程表 考试', undefined],
    ])
  })
})

const base: Task = { id: 't1', courseId: 'c1', title: '第三章习题', kind: 'homework', done: false, createdAt: 0 }

describe('作业与考试', () => {
  it('作业：截止时刻的短事件，提醒和设置里的完全一致；没时刻按当天 23:00', () => {
    const s = snap({ courses: [course] })
    const [timed] = noWeeks(planCalendar(s, [{ ...base, due: '2026-09-10', dueMinutes: 21 * 60 }], prefs, now))
    expect(timed.kind).toBe('task')
    expect(timed.calendar).toBe(TASK_CALENDAR)
    expect(timed.event.title).toBe('第三章习题（高等数学）')
    expect(timed.event.allDay).toBe(false)
    expect(timed.event.start).toBe(new Date('2026-09-10T21:00:00').getTime())
    expect(timed.reminders).toEqual([120, 1440])

    const three = { ...prefs, taskLeads: [3 * 24 * 60, 24 * 60, 15] }
    const [untimed] = noWeeks(planCalendar(s, [{ ...base, due: '2026-09-10' }], three, now))
    expect(untimed.event.allDay).toBe(false)
    expect(untimed.event.start).toBe(new Date('2026-09-10T23:00:00').getTime())
    expect(untimed.reminders).toEqual([15, 1440, 4320])
  })

  it('做完的、收件箱里的、过期太久的不进日历', () => {
    const tasks: Task[] = [
      { ...base, id: 'a', due: '2026-09-10', done: true },
      { ...base, id: 'b', due: '2026-09-10', inbox: true },
      { ...base, id: 'c', due: '2026-06-01' },
      { ...base, id: 'd' },
    ]
    expect(noWeeks(planCalendar(snap({ courses: [course] }), tasks, prefs, now))).toHaveLength(0)
  })

  it('考试：标题补「考试」、地点带座位、按天数模板提醒', () => {
    const exam: Task = { ...base, id: 'e', kind: 'exam', title: '期中', due: '2026-10-20', dueMinutes: 14 * 60, endMinutes: 16 * 60, location: '教一 101', seat: '23' }
    const [e] = noWeeks(planCalendar(snap({ courses: [course] }), [exam], prefs, now))
    expect(e.kind).toBe('exam')
    expect(e.calendar).toBe(EXAM_CALENDAR)
    expect(e.event.title).toBe('期中考试（高等数学）')
    const [named] = noWeeks(planCalendar(snap({ courses: [course] }), [{ ...exam, title: '期末考' }], prefs, now))
    expect(named.event.title).toBe('期末考（高等数学）')
    expect(e.event.location).toBe('教一 101 座位 23')
    expect(e.event.end! - e.event.start).toBe(2 * 60 * 60000)
    // 7/3/1 天前早 8 点 + 当天早 8 点
    expect(e.reminders).toEqual([360, 1800, 4680, 10440])
  })
})

describe('汇总与哈希', () => {
  it('summarize 按课名去重', () => {
    const r2 = { ...weekly, id: 'r2', weekday: 3 as const }
    const ev = planCalendar(snap({ courses: [course], rules: [weekly, r2] }), [{ ...base, due: '2026-09-10' }], prefs, now)
    expect(summarize(ev)).toEqual({ courses: 1, tasks: 1, exams: 0 })
  })

  it('内容或提醒变了哈希就变', () => {
    const [a] = planCalendar(snap({ courses: [course], rules: [weekly] }), [], prefs, now)
    const [b] = planCalendar(snap({ courses: [course], rules: [weekly] }), [], { ...prefs, classLead: 10 }, now)
    const [c] = planCalendar(snap({ courses: [{ ...course, name: '高数' }], rules: [weekly] }), [], prefs, now)
    expect(eventHash(a)).not.toBe(eventHash(b))
    expect(eventHash(a)).not.toBe(eventHash(c))
    expect(eventHash(a)).toBe(eventHash(planCalendar(snap({ courses: [course], rules: [weekly] }), [], prefs, now)[0]))
  })
})
