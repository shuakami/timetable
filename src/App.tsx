import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const C = {
  math: '#6D78D6',
  eng: '#22A06B',
  ds: '#E8871A',
  phy: '#2E90FA',
  la: '#8B5CF6',
  pol: '#DE5B78',
}

/* ---------------- shared ---------------- */

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-[812px] w-[375px] flex-col overflow-hidden rounded-[40px] bg-(--c-bg)">
      {children}
    </div>
  )
}

function Nav({ active }: { active: number }) {
  const items: [React.ReactNode, string][] = [
    [<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" key="h" />, '今天'],
    [<g key="c"><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M3 9h18M8 2v4M16 2v4" /></g>, '课表'],
    [<g key="t"><path d="M9 11.5 11 14l4-5" /><rect x="3.5" y="4" width="17" height="16" rx="4" /></g>, '待办'],
    [<g key="s"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></g>, '我的'],
  ]
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[8] flex justify-center px-4">
      <div
        className="flex w-[92%] items-center justify-between rounded-full p-[5px]"
        style={{
          background: 'var(--c-dock)',
          border: '1px solid var(--c-dock-line)',
          boxShadow: 'var(--c-dock-shadow)',
        }}
      >
        {items.map(([ic, label], i) => {
          const on = i === active
          return (
            <div key={label} className="relative flex flex-1 flex-col items-center gap-[2px] px-1 pt-[6px] pb-[5px]">
              {on && <i className="absolute inset-x-[1px] inset-y-0 rounded-full bg-(--c-accent-soft)" />}
              <svg viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--c-accent)' : 'var(--c-ink)'} strokeWidth="2.2" className="relative z-10 h-[19px] w-[19px]">{ic}</svg>
              <span className={`relative z-10 text-[9.5px] font-bold ${on ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- 01 today ---------------- */

type Course = {
  jie: string
  start: string
  end: string
  name: string
  loc: string
  teacher: string
  color: string
  state: 'past' | 'now' | 'next' | 'later'
  extra?: string
}

type Day = {
  key: string
  rel: string
  date: string
  w: string
  d: string
  n: number
  today?: boolean
  courses: Course[]
}

const days: Day[] = [
  {
    key: 'mon', rel: '', date: '10月13日', w: '周一', d: '13', n: 4, courses: [],
  },
  {
    key: 'today', rel: '今天', date: '10月14日', w: '周二', d: '14', n: 5, today: true,
    courses: [
      { jie: '1–2节', start: '08:00', end: '09:40', name: '大学英语（三）', loc: '外语楼 105', teacher: '陈晓', color: C.eng, state: 'past' },
      { jie: '3–4节', start: '10:00', end: '11:40', name: '高等数学（下）', loc: '教学三楼 302', teacher: '王立群', color: C.math, state: 'now', extra: '还剩 38 分钟' },
      { jie: '5–6节', start: '14:00', end: '15:40', name: '数据结构', loc: '教学一楼 201', teacher: '李慕华', color: C.ds, state: 'next', extra: '作业今晚截止' },
      { jie: '7–8节', start: '16:00', end: '17:40', name: '体育（羽毛球）', loc: '东区体育馆', teacher: '记得带球拍', color: C.phy, state: 'later' },
      { jie: '9–10节', start: '19:00', end: '20:40', name: '线性代数习题课', loc: '教学三楼 110', teacher: '选到课', color: C.la, state: 'later' },
    ],
  },
  {
    key: 'tomorrow', rel: '明天', date: '10月15日', w: '周三', d: '15', n: 2,
    courses: [
      { jie: '3–4节', start: '10:00', end: '11:40', name: '数据结构', loc: '教学一楼 201', teacher: '李慕华', color: C.ds, state: 'later' },
      { jie: '5–6节', start: '14:00', end: '15:40', name: '大学物理', loc: '理科楼 A203', teacher: '周敏', color: C.phy, state: 'later', extra: '带实验报告' },
    ],
  },
  {
    key: 'after', rel: '后天', date: '10月16日', w: '周四', d: '16', n: 3,
    courses: [
      { jie: '1–2节', start: '08:00', end: '09:40', name: '高等数学（下）', loc: '教学三楼 302', teacher: '王立群', color: C.math, state: 'later' },
      { jie: '5–6节', start: '14:00', end: '15:40', name: '线性代数', loc: '教学三楼 110', teacher: '赵一鸣', color: C.la, state: 'later' },
      { jie: '7–8节', start: '16:00', end: '17:40', name: '形势与政策', loc: '教学二楼 404', teacher: '刘岩', color: C.pol, state: 'later' },
    ],
  },
  {
    key: 'fri', rel: '', date: '10月17日', w: '周五', d: '17', n: 2,
    courses: [
      { jie: '1–2节', start: '08:00', end: '09:40', name: '大学物理', loc: '理科楼 A203', teacher: '周敏', color: C.phy, state: 'later' },
      { jie: '3–4节', start: '10:00', end: '11:40', name: '数据结构（上机）', loc: '机房 B2', teacher: '李慕华', color: C.ds, state: 'later' },
    ],
  },
  { key: 'sat', rel: '', date: '10月18日', w: '周六', d: '18', n: 0, courses: [] },
]

const todayIndex = days.findIndex((d) => d.today)
const nowLabel = '11:02'
const nowTop = 127
const todayDate = 14

function DayPicker({ active, lead, trail, className = '', style }: { active: number; lead?: React.ReactNode; trail?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`flex items-stretch gap-[5px] ${className}`}>
      {lead}
      {days.map((d, i) => {
        const on = i === active
        const past = i < todayIndex && !on
        return (
          <div key={d.d} className="relative flex flex-1 flex-col items-center py-[5px]">
            {on && <i className="absolute inset-x-[-1px] inset-y-0 rounded-[13px] bg-(--c-accent-soft)" />}
            <span className={`relative z-10 text-[17px] leading-[1.2] font-bold tabular-nums ${on ? 'text-(--c-accent)' : past ? 'text-(--c-ink5b)' : 'text-(--c-ink)'}`}>{d.d}</span>
            <span className={`relative z-10 mt-0.5 text-[10.5px] font-semibold ${on ? 'text-(--c-accent)' : past ? 'text-(--c-ink5b)' : 'text-(--c-ink4)'}`}>{i === todayIndex ? '今天' : d.w}</span>
            {d.n > 0 && <span className={`absolute top-1 right-1.5 z-10 text-[9px] font-bold tabular-nums ${on ? 'text-(--c-accent2)' : past ? 'text-(--c-ink5b)' : 'text-(--c-ink5)'}`}>{d.n}</span>}
          </div>
        )
      })}
      {trail}
    </div>
  )
}

const dockStyle = {
  background: 'var(--c-dock)',
  border: '1px solid var(--c-dock-line)',
  boxShadow: 'var(--c-dock-shadow)',
}

function DateStrip({ active }: { active: number }) {
  return (
    <DayPicker
      active={active}
      style={dockStyle}
      className="absolute inset-x-4 bottom-[104px] z-[9] rounded-[1.5rem] px-2 py-1.5"
      trail={
        <div className="flex w-10 flex-none items-center justify-center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink2)" strokeWidth="1.9"><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
        </div>
      }
    />
  )
}

function CourseRow({ c }: { c: Course }) {
  const past = c.state === 'past'
  const now = c.state === 'now'
  return (
    <div className="flex">
      <div className={`w-11 flex-none pt-0.5 text-left ${past ? 'opacity-50' : ''}`}>
        <div className="text-[11px] font-bold text-(--c-ink2)">{c.jie}</div>
        <div className="mt-1 text-[11px] font-medium tabular-nums text-(--c-ink4)">{c.start}</div>
        <div className="text-[11px] font-medium tabular-nums text-(--c-ink5)">{c.end}</div>
      </div>
      <div className="relative ml-3 w-[2px] flex-none self-stretch bg-(--c-line)">
        {past && <i className="absolute inset-0 bg-(--c-accent)" />}
        {now && (
          <>
            <i className="absolute inset-x-0 top-0 h-[55%] bg-(--c-accent)" />
            <i className="absolute top-[55%] left-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-(--c-accent) bg-(--c-surface)" />
          </>
        )}
      </div>
      <div className={`flex-1 pb-7 pl-4 ${past ? 'opacity-50' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="text-[16px] leading-[1.25] font-bold tracking-[-.01em] text-(--c-ink)">{c.name}</div>
          {c.state === 'next' && c.extra && (
            <span className="ml-2 flex-none rounded-[7px] bg-(--c-accent-soft) px-2 py-[3px] text-[10.5px] font-bold text-(--c-accent)">{c.extra}</span>
          )}
          {past && <span className="ml-2 flex-none text-[11px] font-semibold text-(--c-ink4b)">已结束</span>}
        </div>
        <div className="mt-1 text-[12.5px] font-medium text-(--c-ink3)">{c.loc}，{c.teacher}</div>
        {now && <div className="mt-1.5 text-[12px] font-bold tabular-nums text-(--c-accent)">上课中，现在 11:02，还剩 38 分钟</div>}
        {c.state === 'next' && <div className="mt-1.5 text-[12px] font-semibold text-(--c-ink3)">下一节，午休后 14:00 开始</div>}
        {c.state === 'later' && c.extra && <div className="mt-1.5 text-[12px] font-semibold text-(--c-ink3)">{c.extra}</div>}
      </div>
    </div>
  )
}

function DayDivider({ day }: { day: Day }) {
  return (
    <div className="flex">
      <div className="flex flex-1 items-baseline justify-between pt-1 pb-7">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[17px] leading-none font-extrabold tracking-[-.02em] text-(--c-ink)">{day.rel || day.w}</span>
          <span className="text-[12.5px] font-semibold text-(--c-ink4)">{day.date}{day.rel ? ` ${day.w}` : ''}</span>
        </div>
        <span className="text-[12px] font-semibold tabular-nums text-(--c-ink4)">{day.n} 节课，{day.courses[0].start} 开始</span>
      </div>
    </div>
  )
}

function TodayScreen({ overlay }: { overlay?: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const marks = useRef<Record<string, HTMLDivElement>>({})
  const [active, setActive] = useState(todayIndex)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const base = el.getBoundingClientRect().top + 96
    let cur = todayIndex
    for (const d of days) {
      const node = marks.current[d.key]
      if (node && node.getBoundingClientRect().top <= base) cur = days.indexOf(d)
    }
    setActive(cur)
  }

  useLayoutEffect(() => {
    const m = location.hash.match(/^#scroll=(\d+)$/)
    if (m && scrollRef.current) scrollRef.current.scrollTop = Number(m[1])
    onScroll()
  }, [])

  const visible = days.filter((d) => d.courses.length > 0 && days.indexOf(d) >= todayIndex)

  return (
    <Phone>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto pt-12 pb-[200px] [scrollbar-width:none]">
        <div className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">10月14日 <span className="font-bold text-(--c-ink4)">周二</span></h1>
          <div className="mt-2 flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            <span>第 7 周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>单周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>5 节课<span className="text-(--c-ink4)">，剩 3 节</span></span>
          </div>
        </div>

        <div className="mt-6 px-5">
          {visible.map((day, di) => (
            <div
              key={day.key}
              ref={(el) => {
                if (el) marks.current[day.key] = el
              }}
            >
              {di > 0 && <DayDivider day={day} />}
              {day.courses.map((c) => (
                <CourseRow key={day.key + c.name + c.start} c={c} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] h-[200px]"
        style={{ background: 'var(--c-fade)' }}
      />
      {!overlay && <DateStrip active={active} />}
      {overlay}
      <Nav active={0} />
    </Phone>
  )
}

/* ---------------- 02 week ---------------- */

type Ev = { name: string; loc: string; color: string; top: number; h: number; now?: boolean }
const weekCols: Ev[][] = [
  [
    { name: '大学英语', loc: '外语楼105', color: C.eng, top: 0, h: 72 },
    { name: '高等数学', loc: '教三302', color: C.math, top: 84, h: 72 },
    { name: '短课演示', loc: '40分钟', color: C.pol, top: 252, h: 28 },
    { name: '思想道德', loc: '教二404', color: C.pol, top: 322, h: 72 },
  ],
  [
    { name: '大学英语', loc: '外语楼105', color: C.eng, top: 0, h: 72 },
    { name: '高等数学', loc: '上课中', color: C.math, top: 84, h: 72, now: true },
    { name: '数据结构', loc: '教一201', color: C.ds, top: 252, h: 72 },
    { name: '体育', loc: '东区馆', color: C.phy, top: 336, h: 72 },
    { name: '线代习题', loc: '教三110', color: C.la, top: 462, h: 72 },
  ],
  [
    { name: '数据结构', loc: '教一201', color: C.ds, top: 84, h: 72 },
    { name: '大学物理', loc: '理科楼A', color: C.phy, top: 252, h: 72 },
  ],
  [
    { name: '高等数学', loc: '教三302', color: C.math, top: 0, h: 72 },
    { name: '线性代数', loc: '教三110', color: C.la, top: 252, h: 72 },
    { name: '形势政策', loc: '教二404', color: C.pol, top: 336, h: 72 },
  ],
  [
    { name: '大学物理', loc: '理科楼A', color: C.phy, top: 0, h: 72 },
    { name: '数据结构', loc: '机房B2', color: C.ds, top: 84, h: 72 },
  ],
  [],
]

function tint(color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, var(--c-tint-base))`
}

function WeekScreen({ overlay }: { overlay?: React.ReactNode }) {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="flex items-center justify-between px-5">
          <div className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">
            第 7 周
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            <span>单周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>秋季学期</span>
          </div>
        </div>

        <div className="mt-3.5 px-2">
          <div className="rounded-[22px] bg-(--c-surface) p-2.5 pb-4">
            <DayPicker
              active={todayIndex}
              lead={<div className="-mr-[5px] flex w-8 flex-none items-center justify-center text-[10.5px] font-semibold text-(--c-ink4)">10月</div>}
            />

            <div className="relative mt-2">
              {[0, 84, 168, 252, 336, 420, 504].map((t) => (
                <div key={t} className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: t + 6 }} />
              ))}
              <div className="flex pt-1.5">
                <div className="relative w-8 flex-none">
                  {['8:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => (
                    <div key={t} className="h-[84px] pr-1.5 text-right text-[9.5px] font-semibold tabular-nums text-(--c-ink4b)">{t}</div>
                  ))}
                  <div className="absolute right-1.5 text-[9.5px] font-bold tabular-nums text-(--c-accent)" style={{ top: nowTop - 6 }}>{nowLabel}</div>
                </div>
                <div className="relative flex h-[536px] flex-1 gap-[5px]">
                  {weekCols.map((col, i) => {
                    const pastCol = i < todayIndex
                    return (
                      <div key={i} className={`relative flex-1 ${pastCol ? 'opacity-45' : ''}`}>
                        {col.map((ev) => {
                          const done = i < todayIndex || (i === todayIndex && ev.top + ev.h <= nowTop)
                          return (
                            <div
                              key={ev.name + ev.top}
                              className="absolute inset-x-0 overflow-hidden rounded-[9px] px-1 py-1.5 text-[9.5px] leading-[1.35] font-bold"
                              style={{
                                top: ev.top,
                                height: ev.h,
                                background: tint(ev.color, ev.now ? 22 : done ? 7 : 10),
                                color: `color-mix(in srgb, ${ev.color} 85%, var(--c-ink-mix))`,
                                boxShadow: ev.now ? `inset 0 0 0 1.5px ${ev.color}` : undefined,
                                opacity: done && !pastCol ? 0.55 : 1,
                              }}
                            >
                              {ev.name}
                              <div className="mt-0.5 text-[8.5px] leading-[1.3] font-semibold opacity-60">{ev.loc}</div>
                              {ev.now && (
                                <div className="pointer-events-none absolute inset-x-0 top-0 bg-(--c-surface)/60" style={{ height: nowTop - ev.top }} />
                              )}
                            </div>
                          )
                        })}
                        {i === todayIndex && (
                          <div className="pointer-events-none absolute right-[-2px] left-[-2px] z-20" style={{ top: nowTop }}>
                            <i className="block h-[1.5px] w-full rounded-full bg-(--c-accent)" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {overlay}
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- 07 / 08 calendar sheets ---------------- */

const monthRows: (number | null)[][] = [
  [null, null, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
  [27, 28, 29, 30, 31, null, null],
]

const byWeekday = [4, 5, 2, 3, 2, 0, 0]
const countOf = (d: number) => byWeekday[(d + 1) % 7]

const rowWeeks = [5, 6, 7, 8, 9]

function CalendarSheet({ mode }: { mode: 'day' | 'week' }) {
  return (
    <>
      <div className="absolute inset-0 z-[19] bg-[#1B1C20]/25" />
      <div className="absolute inset-x-0 bottom-0 z-[20] rounded-t-[26px] bg-(--c-surface) px-4 pt-6 pb-9">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[19px] font-extrabold tracking-[-.02em] text-(--c-ink)">10月</span>
            <span className="text-[12px] font-semibold text-(--c-ink4)">秋季学期 第 5–9 周</span>
          </div>
          <div className="flex items-center gap-4">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.4"><path d="m9 5 7 7-7 7" /></svg>
            <span className="text-[12.5px] font-bold text-(--c-accent)">{mode === 'day' ? '今天' : '本周'}</span>
          </div>
        </div>

        <div className="mt-5 flex gap-[5px]">
          <div className="w-7 flex-none" />
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <div key={w} className="flex-1 text-center text-[10.5px] font-semibold text-(--c-ink4)">{w}</div>
          ))}
        </div>

        <div className="mt-2 space-y-[3px]">
          {monthRows.map((row, ri) => {
            const rowOn = mode === 'week' && rowWeeks[ri] === 7
            return (
              <div key={ri} className={`flex gap-[5px] rounded-[12px] ${rowOn ? 'bg-(--c-accent-soft)' : ''}`}>
                <div className="flex w-7 flex-none items-center justify-center">
                  <span className={`text-[10.5px] font-bold tabular-nums ${rowOn ? 'text-(--c-accent)' : 'text-(--c-ink5)'}`}>{rowWeeks[ri]}</span>
                </div>
                {row.map((d, ci) => {
                  if (d === null) return <div key={ci} className="flex-1" />
                  const n = countOf(d)
                  const on = mode === 'day' ? d === todayDate : rowOn
                  const cell = mode === 'day' && on
                  return (
                    <div key={ci} className="relative flex flex-1 flex-col items-center py-[9px]">
                      {cell && <i className="absolute inset-x-[-1px] inset-y-0 rounded-[13px] bg-(--c-accent-soft)" />}
                      <span className={`relative z-10 text-[15px] leading-[1.2] font-bold tabular-nums ${on ? 'text-(--c-accent)' : n ? 'text-(--c-ink)' : 'text-(--c-ink5)'}`}>{d}</span>
                      <span className={`relative z-10 mt-1 h-[3px] w-[3px] rounded-full ${n ? (on ? 'bg-(--c-accent)' : 'bg-(--c-ink5b)') : 'bg-transparent'}`} />
                      {n > 0 && <span className={`absolute top-1 right-1.5 z-10 text-[9px] font-bold tabular-nums ${on ? 'text-(--c-accent2)' : 'text-(--c-ink5)'}`}>{n}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex items-baseline justify-between pt-1">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[14px] font-bold text-(--c-ink)">{mode === 'day' ? '10月14日 周二' : '第 7 周'}</span>
            <span className="text-[12px] font-semibold tabular-nums text-(--c-ink4)">{mode === 'day' ? '5 节课，08:00 – 20:40' : '10.13 – 10.19，单周，18 节课'}</span>
          </div>
          <span className="text-[12.5px] font-bold text-(--c-accent)">收起</span>
        </div>
      </div>
    </>
  )
}

/* ---------------- 03 detail ---------------- */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-(--c-surface) p-5 ${className}`}>{children}</div>
}

function DetailScreen() {
  return (
    <Phone>
      <div className="flex-1 space-y-3 overflow-hidden px-4 pt-12">
        <div className="flex items-center justify-between px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--c-surface)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink)" strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--c-surface)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#6D78D6" stroke="#6D78D6" strokeWidth="1.8"><path d="M6 3.5h12V21l-6-4-6 4z" /></svg>
          </div>
        </div>

        <Card>
          <div className="text-[22px] font-extrabold tracking-[-.01em] text-(--c-ink)">高等数学（下）</div>
          <div className="mt-1.5 text-[12.5px] font-medium text-(--c-ink3)">必修课，5 学分，第 1–16 周</div>
          <div className="mt-5">
            {([
              ['下次上课', '后天 08:00 – 09:40'],
              ['地点', '教学三楼 302'],
              ['老师', '王立群，数学学院'],
              ['教师电话', <a key="p" href="tel:13845214521" className="inline-flex items-center gap-1 font-semibold text-(--c-accent)">138 <span>****</span> 4521<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg></a>],
              ['上课时间', <span key="t" className="block space-y-1.5 tabular-nums"><span className="block">每周二 08:00 – 09:40</span><span className="block">每周四 08:00 – 09:40</span><span className="block text-[12px] font-medium text-(--c-ink4)">第 1–16 周</span></span>],
              ['考核', '期末 60%，平时 40%'],
              ['提醒', '上课前 20 分钟'],
            ] as [string, React.ReactNode][]).map(([k, v], i) => (
              <div key={k} className={`flex items-baseline ${i > 0 ? 'mt-4' : ''}`}>
                <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">{k}</span>
                <span className="text-[14px] font-semibold text-(--c-ink)">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-baseline">
            <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">学期进度</span>
            <span className="text-[14px] font-semibold tabular-nums text-(--c-ink)">13 / 64 课时</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-(--c-surface2)">
            <i className="block h-full w-[20.3%] rounded-full bg-(--c-accent)" />
          </div>
          <div className="mt-4 flex items-baseline border-t border-(--c-line2) pt-3.5">
            <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">出勤</span>
            <span className="text-[14px] font-semibold tabular-nums text-(--c-ink)">6 / 7，出勤率 86%</span>
          </div>
          <div className="mt-3 flex gap-1.5">
            {[1, 1, 1, 0, 1, 1, 1, 2, 2].map((v, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${v === 1 ? 'bg-(--c-accent)' : v === 0 ? 'bg-(--c-ink5b)' : 'bg-(--c-surface2)'}`} />
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-bold text-(--c-ink)">作业与备忘</span>
            <span className="text-[12px] font-semibold text-(--c-accent)">添加</span>
          </div>
          <div className="mt-1">
            <div className="flex items-baseline justify-between border-b border-(--c-line2) py-3">
              <div>
                <div className="text-[14px] font-semibold text-(--c-ink)">习题册 P41–P45 曲面积分</div>
                <div className="mt-1 text-[12px] font-medium text-(--c-ink4)">第 6 章，纸质提交</div>
              </div>
              <span className="flex-none text-[12px] font-bold text-(--c-accent)">周四截止</span>
            </div>
            <div className="flex items-baseline justify-between py-3">
              <div>
                <div className="text-[14px] font-semibold text-(--c-ink)">期中考试，覆盖 1–5 章</div>
                <div className="mt-1 text-[12px] font-medium text-(--c-ink4)">可带计算器</div>
              </div>
              <span className="flex-none text-[12px] font-semibold text-(--c-ink4)">第 9 周</span>
            </div>
          </div>
        </Card>
      </div>
    </Phone>
  )
}

/* ---------------- 04 add course ---------------- */

type Rule = {
  name: string
  meta: string
  tag?: string
  running?: boolean
  progress?: string
  pct?: number
}

const myRules: Rule[] = [
  { name: '正方教务 通用规则', meta: 'v2.3，链接添加，上周更新', tag: '上次用', running: true, progress: '正在解析，已识别 18 门课', pct: 62 },
  { name: '教务导出 xlsx', meta: 'v1.4，AI 生成，读取本地文件' },
  { name: '雨课堂 课程同步', meta: 'v0.9，链接添加，需要登录一次' },
]

const ruleSources: [string, string][] = [
  ['从链接添加', '粘贴规则链接或分享码'],
  ['让 AI 生成规则', '复制 Prompt，AI 写好后粘贴即可'],
]

function AddScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <div className="flex items-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink)" strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
          </div>
        </div>
        <h1 className="mt-4 text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">导入课表</h1>
        <div className="mt-1.5 text-[13px] font-medium text-(--c-ink4)">选一条规则，选中就开始解析导入</div>

        <div className="mt-6 text-[12.5px] font-semibold text-(--c-ink3)">我的规则</div>
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          {myRules.map((r, i) => (
            <div key={r.name} className={`px-4 py-3.5 ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
              <div className="flex items-center">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[14.5px] font-bold ${r.running ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{r.name}</span>
                    {r.tag && !r.running && <span className="rounded-[6px] bg-(--c-surface2) px-1.5 py-[2px] text-[10px] font-bold text-(--c-ink3)">{r.tag}</span>}
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-(--c-ink4)">{r.running ? r.progress : r.meta}</div>
                </div>
                {r.running ? (
                  <svg className="ml-3 h-[15px] w-[15px] flex-none animate-spin" viewBox="0 0 24 24" fill="none" stroke="#4F5BD5" strokeWidth="2.6" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.4" className="ml-3 flex-none"><path d="m9 5 7 7-7 7" /></svg>
                )}
              </div>
              {r.running && (
                <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-(--c-accent-soft)">
                  <i className="block h-full rounded-full bg-(--c-accent)" style={{ width: `${r.pct}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 text-[12.5px] font-semibold text-(--c-ink3)">添加新规则</div>
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          {ruleSources.map(([t, d], i) => (
            <div key={t} className={`flex items-center px-4 py-3.5 ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-(--c-ink)">{t}</div>
                <div className="mt-0.5 text-[12px] font-medium text-(--c-ink4)">{d}</div>
              </div>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.4" className="flex-none"><path d="m9 5 7 7-7 7" /></svg>
            </div>
          ))}
        </div>

        <div className="mt-5 px-1 text-[11.5px] leading-[1.5] font-medium text-(--c-ink4b)">
          上次导入 21 门课，9月1日，用时 6 秒。
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- 05 add rule from link ---------------- */

function TopBar({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <div className="flex items-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink)" strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
        </div>
      </div>
      <h1 className="mt-4 text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">{title}</h1>
      {sub && <div className="mt-1.5 text-[13px] leading-[1.5] font-medium text-(--c-ink4)">{sub}</div>}
    </>
  )
}

const parsed = [
  { name: '高等数学（下）', when: '周二 3–4 节', loc: '教学三楼 302', teacher: '王立群', weeks: '1–16 周', color: C.math },
  { name: '大学英语（三）', when: '周一 1–2 节', loc: '外语楼 105', teacher: '陈晓', weeks: '1–16 周', color: C.eng },
  { name: '数据结构', when: '周二 5–6 节', loc: '教学一楼 201', teacher: '李慕华', weeks: '1–14 周', color: C.ds },
  { name: '大学物理', when: '周三 5–6 节', loc: '理科楼 A203', teacher: '周敏', weeks: '2–16 双周', color: C.phy },
  { name: '线性代数', when: '周四 5–6 节', loc: '教学三楼 110', teacher: '赵一鸣', weeks: '1–12 周', color: C.la },
]

function LinkScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="从链接添加" sub="粘贴规则链接或分享码" />

        <div className="mt-6 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-(--c-ink4)">规则链接</span>
            <span className="text-[13px] font-bold text-(--c-accent)">粘贴</span>
          </div>
          <div className="mt-2 font-mono text-[12.5px] leading-[1.5] break-all text-(--c-ink)">
            lexicon://rule/zfjw-generic?v=2.3<i className="ml-[1px] inline-block h-[15px] w-[1.5px] translate-y-[2px] bg-(--c-accent)" />
          </div>
        </div>

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">解析出 18 门课</div>

        <div className="mt-2.5 rounded-[16px] bg-(--c-surface) px-3 pt-2.5 pb-3">
          <div className="flex gap-[4px]">
            {['一', '二', '三', '四', '五', '六'].map((w) => (
              <div key={w} className="flex-1 text-center text-[9.5px] font-semibold text-(--c-ink4)">{w}</div>
            ))}
          </div>
          <div className="relative mt-1.5 flex h-[152px] gap-[4px]">
            {[0, 50, 100].map((t) => (
              <div key={t} className="absolute inset-x-0 h-px bg-(--c-line2)" style={{ top: t + 48 }} />
            ))}
            {weekCols.map((col, i) => (
              <div key={i} className="relative flex-1">
                {col.map((ev) => (
                  <div
                    key={ev.name + ev.top}
                    className="absolute inset-x-0 overflow-hidden rounded-[5px] px-1 py-[3px] text-[7.5px] leading-[1.25] font-bold"
                    style={{ top: ev.top * 0.28, height: ev.h * 0.28, background: tint(ev.color, 14), color: `color-mix(in srgb, ${ev.color} 88%, var(--c-ink-mix))` }}
                  >
                    {ev.name}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {parsed.slice(0, 2).map((p) => (
            <div key={p.name} className="flex items-center overflow-hidden rounded-[12px] pr-3.5" style={{ background: tint(p.color, 7) }}>
              <i className="mr-3 h-[42px] w-[3px] flex-none rounded-full" style={{ background: p.color }} />
              <div className="flex-1 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13.5px] font-bold tracking-[-.01em] text-(--c-ink)">{p.name}</span>
                  <span className="ml-2 flex-none text-[11px] font-semibold tabular-nums text-(--c-ink3)">{p.weeks}</span>
                </div>
                <div className="mt-[3px] text-[11.5px] font-medium tabular-nums text-(--c-ink3)">{p.when}　{p.loc}　{p.teacher}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end px-1">
          <span className="text-[13px] font-bold text-(--c-accent)">添加并导入</span>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- 06 let AI write the rule ---------------- */

const promptLines: [string, string][][] = [
  [['你是课表导入规则生成器。我会粘上我', 's']],
  [['学校教务系统课表页面的内容（文字', 's']],
  [['或截图），请输出一份 ', 's'], ['lexicon-rule', 'k'], [' v1', 's']],
  [['规则，要求：', 's']],
  [['1. ', 'p'], ['fields', 'k'], [' 包含 ', 's'], ['name / time /', 'k']],
  [['   ', 'p'], ['room / teacher / weeks', 'k']],
  [['2. 周次用正则，兼容「单双周」写法', 's']],
  [['3. 只输出规则本体，不要解释', 's']],
]

function AiRuleScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="让 AI 生成规则" sub="复制这段 Prompt 交给任意 AI，写好后粘贴即可" />

        <div className="relative mt-6 rounded-[16px] bg-(--c-surface) px-4 py-4">
          <div className="absolute top-3.5 right-4">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink2)" strokeWidth="1.9"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" /></svg>
          </div>
          {promptLines.map((line, i) => (
            <div key={i} className="pr-8 font-mono text-[11.5px] leading-[1.95]">
              {line.map(([t, c], j) => (
                <span key={j} className="whitespace-pre" style={{ color: c === 'k' ? 'var(--c-mono-key)' : c === 'p' ? 'var(--c-mono-punc)' : 'var(--c-mono-ink)', fontWeight: c === 'k' ? 700 : 500 }}>{t}</span>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-(--c-ink4)">AI 输出的规则</span>
            <span className="text-[13px] font-bold text-(--c-accent)">粘贴</span>
          </div>
          <div className="mt-2 font-mono text-[12.5px] leading-[1.5] text-(--c-ink5)">在这里粘贴，或拖入 .rule 文件</div>
        </div>

        <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5 text-center">
          <span className="text-[13px] font-bold text-(--c-ink5)">解析并预览</span>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- 07 todo ---------------- */

type Todo = {
  title: string
  course: string
  color: string
  meta: string
  left: string
  kind?: 'exam'
  done?: boolean
  urgent?: boolean
}

const todoGroups: [string, string, Todo[]][] = [
  ['今天', '2 项', [
    { title: '习题册 P41–P45 曲面积分', course: '高等数学（下）', color: C.math, meta: '今晚 23:00 截止', left: '还剩 11 小时', urgent: true },
    { title: '实验报告：单摆测重力加速度', course: '大学物理', color: C.phy, meta: '课上交，14:00', left: '带纸质版' },
  ]],
  ['这周', '3 项', [
    { title: '期中考试 覆盖 1–5 章', course: '线性代数', color: C.la, meta: '10月17日 周五 14:00', left: '3 天后', kind: 'exam' },
    { title: '第 4 次上机：红黑树插入', course: '数据结构', color: C.ds, meta: '10月18日 周六 23:59', left: '4 天后' },
    { title: '背完 Unit 6 词表', course: '大学英语（三）', color: C.eng, meta: '本周内', left: '已完成 60%' },
  ]],
  ['已完成', '', [
    { title: '第 3 次上机：哈希表', course: '数据结构', color: C.ds, meta: '10月11日 提交', left: '', done: true },
  ]],
]

function TodoScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">待办</h1>
          <div className="mt-2 flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            <span>本周 5 项</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>1 项今天到期</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span className="text-(--c-ink4)">已完成 4 项</span>
          </div>
        </div>

        <div className="mt-6 px-5">
          {todoGroups.map(([g, count, list]) => (
            <div key={g} className="mb-5">
              <div className="flex items-baseline justify-between px-0.5">
                <span className="text-[13px] font-extrabold tracking-[-.01em] text-(--c-ink)">{g}</span>
                {count && <span className="text-[11.5px] font-semibold tabular-nums text-(--c-ink4)">{count}</span>}
              </div>
              <div className="mt-2.5 space-y-2">
                {list.map((t) => (
                  <div key={t.title} className={`flex overflow-hidden rounded-[14px] bg-(--c-surface) px-3.5 py-3 ${t.done ? 'opacity-45' : ''}`}>
                    <div className="mt-[3px] mr-3 flex-none">
                      <span
                        className="flex h-[17px] w-[17px] items-center justify-center rounded-[6px] border-[1.8px]"
                        style={{ borderColor: t.done ? t.color : 'var(--c-radio-border)', background: t.done ? t.color : 'transparent' }}
                      >
                        {t.done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6"><path d="m6 12.5 4 4 8-9" /></svg>}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <span className={`text-[14px] leading-[1.3] font-bold tracking-[-.01em] text-(--c-ink) ${t.done ? 'line-through' : ''}`}>{t.title}</span>
                        {t.kind === 'exam' && <span className="ml-2 flex-none rounded-[6px] bg-(--c-rose-soft) px-1.5 py-[2px] text-[10px] font-bold text-(--c-rose)">考试</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <i className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: t.color }} />
                        <span className="text-[11.5px] font-semibold text-(--c-ink3)">{t.course}</span>
                        <span className="text-[11.5px] font-medium tabular-nums text-(--c-ink4)">{t.meta}</span>
                      </div>
                      {t.left && (
                        <div className={`mt-1.5 text-[11.5px] font-bold tabular-nums ${t.urgent ? 'text-(--c-rose)' : 'text-(--c-ink3)'}`}>{t.left}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] h-[150px]"
        style={{ background: 'var(--c-fade)' }}
      />
      <Nav active={2} />
    </Phone>
  )
}

/* ---------------- 08 me ---------------- */

const meGroups: [string, [string, string][]][] = [
  ['课表', [
    ['当前课表', '2025 秋季学期'],
    ['导入规则', '正方教务 通用规则 v2.3'],
    ['作息时间', '10 节课 08:00 起'],
  ]],
  ['提醒', [
    ['上课提醒', '课前 15 分钟'],
    ['作业提醒', '截止前一晚 21:00'],
    ['桌面小组件', '今日时间线'],
  ]],
  ['其他', [
    ['外观', '跟随系统'],
    ['导出与备份', '.ics / .json'],
  ]],
]

function MeScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden">
        <div className="relative h-[258px]">
          <img src="/wall.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_32%]" />
          <div className="absolute inset-x-0 bottom-0 h-[150px] bg-(--c-fade-photo)" />
          <div className="absolute inset-x-0 top-0 h-[92px] bg-gradient-to-b from-black/25 to-transparent" />
          <div className="absolute top-12 right-5 left-5">
            <span className="text-[15px] font-bold tracking-[-.01em] text-white drop-shadow-[0_1px_6px_rgba(0,0,0,.35)]">我的</span>
          </div>
          <div className="absolute inset-x-5 bottom-3 flex items-end">
            <img src="/avatar.jpg" alt="" className="h-[62px] w-[62px] flex-none rounded-full border-[1.5px] border-white object-cover" />
            <div className="mb-1 ml-3.5 flex-1">
              <div className="text-[19px] font-extrabold tracking-[-.02em] text-(--c-ink)">李思远</div>
              <div className="mt-[3px] flex items-center gap-2.5 text-[12px] font-semibold text-(--c-ink3)">
                <span>计算机学院 2023 级</span>
                <span className="tabular-nums text-(--c-ink4b)">20231234</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5">
          <div className="flex rounded-[18px] bg-(--c-surface) px-4 py-3.5">
            {[['18', '门课'], ['24', '学分'], ['86%', '出勤']].map(([n, l], i) => (
              <div key={l} className={`flex-1 ${i ? 'border-l border-(--c-surface2)' : ''}`}>
                <div className="text-center text-[17px] font-extrabold tabular-nums text-(--c-ink)">{n}</div>
                <div className="mt-0.5 text-center text-[11px] font-semibold text-(--c-ink4)">{l}</div>
              </div>
            ))}
          </div>

          {meGroups.map(([g, rows]) => (
            <div key={g} className="mt-5">
              <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink4)">{g}</div>
              <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
                {rows.map(([k, v], i) => (
                  <div key={k} className={`flex items-center py-3.5 ${i ? 'border-t border-(--c-line2)' : ''}`}>
                    <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{k}</span>
                    <span className="text-[12.5px] font-medium text-(--c-ink4)">{v}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.2" className="ml-2"><path d="m9 5 7 7-7 7" /></svg>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] h-[150px]"
        style={{ background: 'var(--c-fade)' }}
      />
      <Nav active={3} />
    </Phone>
  )
}

/* ---------------- 09 notifications ---------------- */

type Notif = {
  tone: 'now' | 'plain' | 'warn' | 'change'
  time: string
  title: string
  body: string
  meta?: string
  acts?: string[]
}

const notifs: Notif[] = [
  {
    tone: 'now', time: '09:45',
    title: '高等数学（下） 10:00 开始',
    body: '教学三楼 302，王立群',
    meta: '还有 15 分钟，走过去约 6 分钟',
    acts: ['静音本节', '看今天'],
  },
  {
    tone: 'warn', time: '09:00',
    title: '习题册 P41–P45 今晚 23:00 截止',
    body: '高等数学（下）',
    meta: '还剩 14 小时',
    acts: ['标记完成', '晚上再提醒'],
  },
  {
    tone: 'change', time: '昨天 21:12',
    title: '明天 大学物理 换到 理科楼 A305',
    body: '21:10 已更新到课表',
    acts: ['看变更'],
  },
  {
    tone: 'plain', time: '07:20',
    title: '今天 5 节课，08:00 开始',
    body: '第一节 大学英语（外语楼 105），晚上还有线代习题课',
    meta: '11:40 之后有 2 小时 20 分钟空档',
  },
]

function NotifCard({ n }: { n: Notif }) {
  return (
    <div
      className="rounded-[20px] px-3.5 py-3"
      style={{
        background: 'rgba(255,255,255,.30)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
      <div className="flex items-center">
        <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] bg-(--c-accent)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M3 9h18" /></svg>
        </span>
        <span className="ml-1.5 flex-1 text-[11.5px] font-semibold tracking-[-.01em] text-white/75">课程表</span>
        <span className="text-[11.5px] font-medium tabular-nums text-white/60">{n.time}</span>
      </div>
      <div className="mt-1.5 text-[14px] leading-[1.32] font-semibold tracking-[-.01em] text-white">{n.title}</div>
      <div className="mt-0.5 text-[13px] leading-[1.35] font-normal text-white/80">{n.body}</div>
      {n.meta && <div className="mt-0.5 text-[13px] leading-[1.35] font-normal tabular-nums text-white/80">{n.meta}</div>}
    </div>
  )
}

function LockScreen() {
  return (
    <Phone>
      <img src="/wall.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
      <div className="absolute inset-0 bg-[#0E1116]/45 backdrop-blur-[2px]" />
      <div className="relative flex-1 px-3.5 pt-12">
        <div className="text-center text-white">
          <div className="text-[15px] font-semibold tracking-[-.01em] opacity-85">10月14日 周二</div>
          <div className="mt-0.5 text-[74px] leading-[1.02] font-semibold tracking-[-.03em] tabular-nums">09:45</div>
        </div>
        <div className="mt-8 space-y-2.5">
          {notifs.map((n) => <NotifCard key={n.title} n={n} />)}
        </div>
      </div>
    </Phone>
  )
}

const notifPrefs: [string, [string, string][]][] = [
  ['上课', [
    ['开课前提醒', '15 分钟'],
    ['第一节课加早提醒', '提前 40 分钟'],
    ['只提醒有变化的课', '开'],
  ]],
  ['作业与考试', [
    ['作业截止', '前一晚 21:00'],
    ['考试倒数', '3 天、当天早上'],
  ]],
  ['变更', [
    ['调课与停课', '立刻推送'],
    ['规则重新导入后差异', '汇总一条'],
  ]],
  ['安静', [
    ['上课中静音', '开'],
    ['夜间不打扰', '23:00 – 07:00'],
    ['没有课的一天', '不发任何通知'],
  ]],
]

function NotifPrefScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">通知</h1>
          <div className="mt-2 text-[12.5px] leading-[1.5] font-medium text-(--c-ink3)">上课前、作业截止前、课表变更时提醒。</div>
        </div>
        <div className="mt-5 px-5">
          {notifPrefs.map(([g, rows]) => (
            <div key={g} className="mt-5 first:mt-0">
              <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink4)">{g}</div>
              <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
                {rows.map(([k, v], i) => (
                  <div key={k} className={`flex items-center py-3.5 ${i ? 'border-t border-(--c-line2)' : ''}`}>
                    <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{k}</span>
                    <span className="text-[12.5px] font-medium tabular-nums text-(--c-ink4)">{v}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.2" className="ml-2"><path d="m9 5 7 7-7 7" /></svg>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] h-[150px]"
        style={{ background: 'var(--c-fade)' }}
      />
      <Nav active={3} />
    </Phone>
  )
}

/* ---------------- 10 widgets ---------------- */

function WCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[24px] bg-(--c-surface) p-3.5 shadow-(--c-lift-shadow) ${className}`}>{children}</div>
  )
}

function WHead({ d, w, sub }: { d: string; w: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[30px] leading-none font-semibold tracking-[-.03em] tabular-nums text-(--c-ink)">{d}</span>
      <span className="text-[13px] font-semibold text-(--c-accent)">{w}</span>
      {sub && <span className="ml-auto text-[11.5px] font-semibold text-(--c-ink4)">{sub}</span>}
    </div>
  )
}

function WRow({ name, time, loc, color, big = true, badge }: { name: string; time?: string; loc?: string; color: string; big?: boolean; badge?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] py-1.5 pr-2.5 pl-0" style={{ background: tint(color, 8) }}>
      <i className="my-[3px] ml-1.5 w-[3px] flex-none self-stretch rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate ${big ? 'text-[13px]' : 'text-[12px]'} leading-[1.3] font-bold tracking-[-.01em] text-(--c-ink)`}>{name}</div>
        {loc && <div className="mt-[1px] truncate text-[11px] leading-[1.25] font-medium text-(--c-ink3)">{loc}</div>}
      </div>
      {badge && (
        <span className="flex-none rounded-full bg-(--c-accent) px-1.5 py-[2px] text-[9.5px] font-bold text-white">{badge}</span>
      )}
      {time && <div className="flex-none text-right text-[11.5px] leading-[1.3] font-semibold tabular-nums text-(--c-ink3)">{time}</div>}
    </div>
  )
}

function WidgetScreen() {
  return (
    <Phone>
      <img src="/wall.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
      <div className="absolute inset-0 bg-[#0E1116]/25" />
      <div className="relative flex-1 px-4 pt-10">
        <div className="flex gap-3.5">
          <WCard className="h-[162px] w-[162px]">
            <WHead d="14" w="周二" />
            <div className="mt-2.5 space-y-1.5">
              <WRow name="高等数学" loc="教三 302" time="10:00" color={C.math} big={false} />
              <WRow name="数据结构" loc="教一 201" time="14:00" color={C.ds} big={false} />
            </div>
          </WCard>
          <WCard className="flex h-[162px] w-[162px] flex-col">
            <div className="text-[11.5px] font-bold text-(--c-ink3)">下一节</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-[38px] leading-none font-semibold tracking-[-.035em] tabular-nums text-(--c-ink)">15</span>
              <span className="text-[13px] font-semibold text-(--c-ink3)">分钟后</span>
            </div>
            <div className="mt-auto">
              <WRow name="高等数学（下）" loc="教三 302　王立群" color={C.math} big={false} />
            </div>
          </WCard>
        </div>

        <WCard className="mt-3.5 flex h-[162px] gap-3.5">
          <div className="flex-1">
            <WHead d="14" w="周二" />
            <div className="mt-2.5 space-y-1.5">
              <WRow name="高等数学（下）" time="10:00" color={C.math} big={false} />
              <WRow name="数据结构" loc="教一 201" time="14:00" color={C.ds} big={false} />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[12px] font-bold text-(--c-ink4)">明天</div>
            <div className="mt-2.5 space-y-1.5">
              <WRow name="数据结构" time="10:00" color={C.ds} big={false} />
              <WRow name="大学物理" loc="理科楼 A203" time="14:00" color={C.phy} big={false} />
            </div>
          </div>
        </WCard>

        <WCard className="mt-3.5 px-3.5 pt-3.5 pb-4">
          <div className="flex items-baseline">
            <span className="text-[17px] font-semibold tracking-[-.02em] text-(--c-ink)">第 7 周</span>
            <span className="ml-2 text-[12px] font-semibold text-(--c-ink4)">10月14日</span>
          </div>
          <div className="mt-3 flex gap-1.5">
            {[
              ['周一', false], ['周二', true], ['周三', false], ['周四', false], ['周五', false],
            ].map(([w, on]) => (
              <div key={w as string} className={`flex-1 text-center text-[11.5px] font-bold ${on ? 'text-(--c-accent)' : 'text-(--c-ink3)'}`}>{w}</div>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {([
              [[C.eng, '大学英语', '08:00', '外语楼 105', false], [C.math, '高等数学', '10:00', '教三 302', false]],
              [[C.eng, '大学英语', '08:00', '外语楼 105', false], [C.math, '高等数学', '10:00', '教三 302', true]],
              [[C.ds, '数据结构', '10:00', '教一 201', false], [C.phy, '大学物理', '14:00', '理科楼 A', false]],
              [[C.math, '高等数学', '08:00', '教三 302', false], [C.la, '线性代数', '14:00', '教三 110', false]],
              [[C.phy, '大学物理', '08:00', '理科楼 A', false], [C.ds, '数据结构', '10:00', '机房 B2', false]],
            ] as [string, string, string, string, boolean][][]).map((col, i) => (
              <div key={i} className="flex flex-1 flex-col gap-1.5">
                {col.map(([color, name, time, loc, now]) => (
                  <div
                    key={name + time}
                    className="h-[64px] rounded-[10px] px-1.5 py-2"
                    style={{
                      background: tint(color, now ? 16 : 8),
                      boxShadow: now ? `inset 0 0 0 1.5px ${color}` : undefined,
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[11px] leading-[1.25] font-bold" style={{ color: `color-mix(in srgb, ${color} 88%, #000)` }}>{name}</span>
                    </div>
                    <div className="mt-1.5 text-[10px] leading-[1.3] font-semibold tabular-nums text-(--c-ink3)">{time}</div>
                    <div className="mt-[1px] truncate text-[10px] leading-[1.3] font-medium text-(--c-ink4)">{loc}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </WCard>
      </div>
    </Phone>
  )
}


function WidgetScreen2() {
  return (
    <Phone>
      <img src="/wall.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
      <div className="absolute inset-0 bg-[#0E1116]/25" />
      <div className="relative flex-1 px-4 pt-10">
        <div className="flex gap-3.5">
          <WCard className="flex h-[196px] w-[162px] flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[24px] leading-none font-semibold tracking-[-.03em] tabular-nums text-(--c-ink)">14</span>
              <span className="text-[12px] font-semibold text-(--c-accent)">周二</span>
              <span className="ml-auto text-[11px] font-semibold text-(--c-ink4)">还剩 3 节</span>
            </div>
            <div className="relative mt-3 flex-1">
              <i className="absolute top-1 bottom-2 left-[3.5px] w-[1.5px] rounded-full bg-(--c-surface2)" />
              <div className="space-y-[13px]">
                {([
                  ['10:00', '高等数学', '教三 302', C.math, 'now'],
                  ['14:00', '数据结构', '教一 201', C.ds, 'next'],
                  ['16:00', '体育', '东区体育馆', C.phy, 'next'],
                ] as [string, string, string, string, string][]).map(([t, name, loc, color, st]) => (
                  <div key={t} className="relative flex gap-2.5 pl-[18px]" style={{ opacity: st === 'past' ? 0.4 : 1 }}>
                    <i
                      className="absolute top-[4px] left-0 h-[8px] w-[8px] rounded-full"
                      style={{ background: st === 'now' ? color : 'var(--c-surface)', boxShadow: `inset 0 0 0 1.5px ${st === 'now' ? color : 'var(--c-dot-border)'}` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] leading-[1.25] font-bold tracking-[-.01em] text-(--c-ink)">{name}</div>
                      <div className="mt-[1px] truncate text-[10.5px] leading-[1.25] font-medium tabular-nums text-(--c-ink3)">{t}　{loc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </WCard>
          <WCard className="flex h-[196px] w-[162px] flex-col">
            <div className="flex items-baseline">
              <span className="text-[11.5px] font-bold text-(--c-ink3)">这周要交</span>
              <span className="ml-auto text-[11px] font-semibold text-(--c-ink4)">3 项未完成</span>
            </div>
            <div className="mt-2.5 space-y-1.5">
              <WRow name="高数习题册" loc="今晚 23:00" color={C.math} big={false} />
              <WRow name="数据结构实验二" loc="周四 18:00" color={C.ds} big={false} />
              <WRow name="物理实验报告" loc="周五 12:00" color={C.phy} big={false} />
            </div>
          </WCard>
        </div>

      </div>
    </Phone>
  )
}

/* ---------------- empty & error states ---------------- */

function EmptyArt({ kind }: { kind: 'free' | 'none' }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="h-[40px] w-[40px]">
      {kind === 'free' ? (
        <>
          <rect x="5" y="9" width="30" height="26" rx="7" stroke="#DEDFE4" strokeWidth="1.6" />
          <path d="M13 6v5M27 6v5" stroke="#DEDFE4" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 22.5 18 26.5l8-8" stroke="#B9BFEC" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="5" y="9" width="30" height="26" rx="7" stroke="#DEDFE4" strokeWidth="1.6" strokeDasharray="3.5 3.5" />
          <path d="M13 6v5M27 6v5" stroke="#DEDFE4" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M20 17v9M15.5 21.5h9" stroke="#C9CBD2" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

function EmptyBlock({
  kind,
  title,
  desc,
  actions,
}: {
  kind: 'free' | 'none'
  title: string
  desc?: string
  actions: string[]
}) {
  return (
    <div className="flex flex-col items-center px-8 text-center">
      <EmptyArt kind={kind} />
      <div className="mt-4 text-[17px] font-extrabold tracking-[-.02em] text-(--c-ink)">{title}</div>
      {desc && <div className="mt-2 text-[13px] leading-[1.6] font-medium text-(--c-ink4)">{desc}</div>}
      <div className="mt-5 flex items-center gap-5">
        {actions.map((a, i) => (
          <span key={a} className={`text-[13px] font-bold ${i === 0 ? 'text-(--c-accent)' : 'text-(--c-ink3)'}`}>{a}</span>
        ))}
      </div>
    </div>
  )
}

function FreeDayScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">10月18日 <span className="font-bold text-(--c-ink4)">周六</span></h1>
          <div className="mt-2 flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            <span>第 7 周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>单周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span className="text-(--c-ink4)">没有课</span>
          </div>
        </div>
        <div className="mt-12">
          <EmptyBlock kind="free" title="今天没有课" actions={['看本周课表', '去待办']} />
        </div>

        <div className="mt-10 px-5">
          <div className="px-1 text-[12px] font-bold tracking-[-.01em] text-(--c-ink4)">下一节</div>
          <div className="mt-2 flex items-center rounded-[16px] bg-(--c-surface) px-4 py-3.5">
            <div className="w-[46px] flex-none">
              <div className="text-[13px] font-extrabold tabular-nums text-(--c-ink)">08:00</div>
              <div className="mt-0.5 text-[11px] font-medium tabular-nums text-(--c-ink5)">09:40</div>
            </div>
            <i className="mr-3.5 h-[34px] w-[3px] flex-none rounded-full" style={{ background: C.eng }} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold tracking-[-.01em] text-(--c-ink)">大学英语（三）</div>
              <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink3)">外语楼 105，陈晓</div>
            </div>
            <span className="ml-2 flex-none text-[11.5px] font-semibold text-(--c-ink4)">周一</span>
          </div>
        </div>
      </div>
      <DateStrip active={5} />
      <Nav active={0} />
    </Phone>
  )
}

function NoDataScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">10月14日 <span className="font-bold text-(--c-ink4)">周二</span></h1>
          <div className="mt-2 text-[12.5px] font-semibold text-(--c-ink4)">还没有课表</div>
        </div>
        <div className="mt-14">
          <EmptyBlock
            kind="none"
            title="还没有课表"
            actions={['导入课表', '手动添加']}
          />
        </div>
      </div>
      <Nav active={0} />
    </Phone>
  )
}

const failedRows: [string, string][] = [
  ['高等数学（下）', '周次写成 2-16双，规则没认出来'],
  ['大学体育（羽毛球）', '这门课没有节次'],
  ['形势与政策', '一行里写了两个上课时间'],
]

function PartialFailScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="3 门课导入失败" sub="其余 18 门已导入，失败的可稍后重试。" />

        <div className="mt-6 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13.5px] font-bold text-(--c-ink)">正方教务 通用规则 v2.3</span>
            <span className="text-[11.5px] font-semibold tabular-nums text-(--c-ink4)">用时 6 秒</span>
          </div>
          <div className="mt-3 flex h-[3px] overflow-hidden rounded-full bg-(--c-surface2)">
            <i className="block h-full" style={{ width: '86%', background: '#4F5BD5' }} />
            <i className="block h-full" style={{ width: '14%', background: '#E8C39A' }} />
          </div>
          <div className="mt-2.5 flex items-baseline gap-4 text-[11.5px] font-semibold tabular-nums">
            <span className="text-(--c-accent)">成功 18 门</span>
            <span className="text-(--c-amber)">失败 3 门</span>
          </div>
        </div>

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">失败的课</div>
        <div className="mt-2.5 space-y-2">
          {failedRows.map(([name, why]) => (
            <div key={name} className="rounded-[12px] bg-(--c-surface) px-3.5 py-3">
              <div className="text-[13.5px] font-bold tracking-[-.01em] text-(--c-ink)">{name}</div>
              <div className="mt-1 text-[12px] font-medium text-(--c-ink3)">{why}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end px-1">
          <span className="text-[13px] font-bold text-(--c-accent)">手动添加</span>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- conflict & changes ---------------- */

type CEv = Ev & { lane?: number; lanes?: number; conflict?: boolean }

const conflictCols: CEv[][] = [
  [
    { name: '大学英语', loc: '外语楼105', color: C.eng, top: 0, h: 72 },
    { name: '高等数学', loc: '教三302', color: C.math, top: 84, h: 72 },
  ],
  [
    { name: '大学英语', loc: '外语楼105', color: C.eng, top: 0, h: 72 },
    { name: '数据结构', loc: '教一201', color: C.ds, top: 84, h: 72, lane: 0, lanes: 2, conflict: true },
    { name: '形势政策', loc: '教二404', color: C.pol, top: 100, h: 72, lane: 1, lanes: 2, conflict: true },
    { name: '大学物理', loc: '理科楼A', color: C.phy, top: 252, h: 72 },
    { name: '线代习题', loc: '教三110', color: C.la, top: 462, h: 72 },
  ],
  [
    { name: '数据结构', loc: '教一201', color: C.ds, top: 84, h: 72 },
    { name: '大学物理', loc: '理科楼A', color: C.phy, top: 252, h: 72 },
  ],
  [
    { name: '高等数学', loc: '教三302', color: C.math, top: 0, h: 72 },
    { name: '线性代数', loc: '教三110', color: C.la, top: 252, h: 72 },
  ],
  [
    { name: '大学物理', loc: '理科楼A', color: C.phy, top: 0, h: 72 },
    { name: '数据结构', loc: '机房B2', color: C.ds, top: 84, h: 72 },
  ],
  [],
]

const conflictPair: [string, string, string, string, string][] = [
  ['数据结构', '10:00–11:40', '教学一楼 201，李慕华', C.ds, '规则导入'],
  ['形势与政策', '10:20–12:00', '教学二楼 404，刘岩', C.pol, '手动添加'],
]

function ConflictScreen({ mode = 'view' }: { mode?: 'view' | 'pick' }) {
  const pick = mode === 'pick'
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="flex items-center justify-between px-5">
          <div className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">
            第 7 周
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <div className="text-[12.5px] font-semibold text-(--c-amber)">1 处时间冲突</div>
        </div>

        <div className="mt-3.5 px-2">
          <div className="rounded-[22px] bg-(--c-surface) p-2.5 pb-4">
            <DayPicker
              active={todayIndex}
              lead={<div className="-mr-[5px] flex w-8 flex-none items-center justify-center text-[10.5px] font-semibold text-(--c-ink4)">10月</div>}
            />
            <div className="relative mt-2">
              {[0, 84, 168, 252, 336, 420, 504].map((t) => (
                <div key={t} className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: t + 6 }} />
              ))}
              <div className="flex pt-1.5">
                <div className="relative w-8 flex-none">
                  {['8:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => (
                    <div key={t} className="h-[84px] pr-1.5 text-right text-[9.5px] font-semibold tabular-nums text-(--c-ink4b)">{t}</div>
                  ))}
                </div>
                <div className="relative flex h-[536px] flex-1 gap-[5px]">
                  {conflictCols.map((col, i) => (
                    <div key={i} className="relative flex-1">
                      {col.map((ev) => {
                        const lane = ev.lane ?? 0
                        const stacked = (ev.lanes ?? 1) > 1
                        return (
                          <div
                            key={ev.name + ev.top}
                            className="absolute"
                            style={{
                              top: ev.top,
                              height: ev.h,
                              left: stacked && lane > 0 ? 5 : 0,
                              right: stacked && lane > 0 ? -5 : 0,
                              zIndex: stacked ? (lane === 0 ? 6 : 5) : undefined,
                              opacity: pick && stacked && lane > 0 ? 0.4 : 1,
                            }}
                          >
                            <div
                              className="absolute inset-0 overflow-hidden rounded-[9px] px-1 py-1.5 text-[9.5px] leading-[1.35] font-bold"
                              style={{
                                background: tint(ev.color, stacked ? 14 : 10),
                                color: `color-mix(in srgb, ${ev.color} 85%, var(--c-ink-mix))`,
                                boxShadow: stacked ? `inset 0 0 0 1.5px ${lane === 0 ? '#E0AC6C' : 'rgba(224,172,108,.55)'}` : undefined,
                              }}
                            >
                              {lane === 0 && ev.name}
                              {stacked && lane === 0 && <div className="mt-0.5 text-[8.5px] leading-[1.3] font-semibold opacity-60">{ev.loc}</div>}
                              {!stacked && <div className="mt-0.5 text-[8.5px] leading-[1.3] font-semibold opacity-60">{ev.loc}</div>}
                            </div>
                            {stacked && lane === 0 && (
                              <span className="absolute top-[-5px] right-[-7px] z-10 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#E0AC6C] text-[8.5px] leading-none font-bold text-white ring-[2px] ring-white">2</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[7]">
        <div className="rounded-t-[26px] bg-(--c-surface) px-5 pt-5 pb-[104px] shadow-(--c-lift-shadow)">
          <div className="text-[17px] font-extrabold tracking-[-.02em] text-(--c-ink)">{pick ? '留哪一门？' : '周二 10:00 有两门课'}</div>
          {pick && <div className="mt-1.5 text-[12.5px] font-medium text-(--c-ink4)">没选的那门从课表里隐藏，不删除</div>}
          <div className={`${pick ? 'mt-4' : 'mt-3.5'} space-y-2`}>
            {conflictPair.map(([name, time, loc, color, from], i) => {
              const on = i === 0
              return (
                <div
                  key={name}
                  className="flex items-center rounded-[12px] px-3.5 py-3"
                  style={{
                    background: pick && !on ? 'var(--c-row-muted)' : tint(color, 7),
                    boxShadow: pick && on ? `inset 0 0 0 1.5px ${color}` : undefined,
                  }}
                >
                  {pick ? (
                    <span
                      className="mr-3 flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-[1.8px]"
                      style={{ borderColor: on ? color : 'var(--c-radio-border)', background: on ? color : 'transparent' }}
                    >
                      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6"><path d="m6 12.5 4 4 8-9" /></svg>}
                    </span>
                  ) : (
                    <i className="mr-3 h-[38px] w-[3px] flex-none rounded-full" style={{ background: color }} />
                  )}
                  <div className={`min-w-0 flex-1 ${pick && !on ? 'opacity-55' : ''}`}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[13.5px] font-bold text-(--c-ink)">{name}</span>
                      <span className="ml-2 flex-none text-[11.5px] font-semibold tabular-nums text-(--c-ink3)">{time}</span>
                    </div>
                    <div className="mt-[3px] truncate text-[11.5px] font-medium text-(--c-ink3)">{loc}　{from}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between">
            {pick ? (
              <>
                <span className="text-[13px] font-medium text-(--c-ink4)">隐藏后随时能恢复</span>
                <div className="flex items-center gap-5">
                  <span className="text-[13px] font-bold text-(--c-ink3)">取消</span>
                  <span className="text-[13px] font-bold text-(--c-accent)">只留数据结构</span>
                </div>
              </>
            ) : (
              <>
                <span className="text-[13px] font-semibold tabular-nums text-(--c-amber)">重叠 1 小时 20 分</span>
                <div className="flex items-center gap-5">
                  <span className="text-[13px] font-bold text-(--c-ink3)">都保留</span>
                  <span className="text-[13px] font-bold text-(--c-accent)">只留一门</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

const diffRows: [string, string, string][] = [
  ['时间', '周四 5–6 节 14:00', '周五 3–4 节 10:00'],
  ['地点', '教学三楼 110', '教学三楼 208'],
]

function ChangeScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="线性代数调课了" sub="11:02 用「正方教务 通用规则」重新导入时发现的变化" />

        <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          {diffRows.map(([k, from, to], i) => {
            const same = from === to
            return (
              <div key={k} className={`px-4 py-3 ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
                <div className="text-[11.5px] font-semibold text-(--c-ink4)">{k}</div>
                {same ? (
                  <div className="mt-1.5 text-[14px] font-bold text-(--c-ink)">{to}</div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <span className="text-[14px] font-medium text-(--c-ink4b) line-through">{from}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.4" className="flex-none"><path d="m9 5 7 7-7 7" /></svg>
                    <span className="text-[14px] font-bold text-(--c-accent)">{to}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">受影响的安排</div>
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center rounded-[12px] px-3.5 py-3" style={{ background: tint(C.la, 7) }}>
            <i className="mr-3 h-[38px] w-[3px] flex-none rounded-full" style={{ background: C.la }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-(--c-ink)">期中考试 覆盖 1–5 章</div>
              <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink3)">原本跟着这节课，时间要不要一起改</div>
            </div>
          </div>
          <div className="flex items-center rounded-[12px] px-3.5 py-3" style={{ background: 'rgba(223,169,104,.09)' }}>
            <i className="mr-3 h-[38px] w-[3px] flex-none rounded-full" style={{ background: '#DFA968' }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-(--c-ink)">新时间和大学物理重叠</div>
              <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink3)">周五 10:00 已有大学物理，理科楼 A203</div>
            </div>
          </div>
        </div>

        <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">这门课以前的变更</div>
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          {([
            ['9月30日', '停课一次', '国庆假期，已从课表移除'],
            ['9月18日', '换教室', '教学三楼 214 → 110，当时已保留'],
          ] as [string, string, string][]).map(([d, what, why], i) => (
            <div key={d} className={`flex items-baseline px-4 py-2.5 ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
              <span className="w-[58px] flex-none text-[11.5px] font-semibold tabular-nums text-(--c-ink4b)">{d}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-(--c-ink)">{what}</div>
                <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink4)">{why}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-5 px-1">
          <span className="text-[13px] font-bold text-(--c-ink3)">撤销变更</span>
          <span className="text-[13px] font-bold text-(--c-accent)">知道了</span>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- week range: out of term / vacation / exam ---------------- */

function WeekShell({
  week,
  right,
  month,
  rightTone = 'gray',
  strip,
  children,
  footer,
}: {
  week: string
  right: string
  month: string
  rightTone?: 'gray' | 'amber' | 'indigo'
  strip: [string, string][]
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const tone = rightTone === 'amber' ? '#C29155' : rightTone === 'indigo' ? '#4F5BD5' : '#8A8E97'
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="flex items-center justify-between px-5">
          <div className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">
            {week}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <div className="text-[12.5px] font-semibold" style={{ color: tone }}>{right}</div>
        </div>

        <div className="mt-3.5 px-2">
          <div className="rounded-[22px] bg-(--c-surface) p-2.5 pb-4">
            <div className="flex items-stretch gap-[5px]">
              <div className="-mr-[5px] flex w-8 flex-none items-center justify-center text-[10.5px] font-semibold text-(--c-ink5)">{month}</div>
              {strip.map(([d, w]) => (
                <div key={d + w} className="relative flex flex-1 flex-col items-center py-[5px]">
                  <span className="text-[17px] leading-[1.2] font-bold tabular-nums text-(--c-ink5b)">{d}</span>
                  <span className="mt-0.5 text-[10.5px] font-semibold text-(--c-ink5b)">{w}</span>
                </div>
              ))}
            </div>

            <div className="relative mt-2">
              {[0, 84, 168, 252, 336, 420, 504].map((t) => (
                <div key={t} className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: t + 6 }} />
              ))}
              <div className="flex pt-1.5">
                <div className="w-8 flex-none">
                  {['8:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => (
                    <div key={t} className="h-[84px] pr-1.5 text-right text-[9.5px] font-semibold tabular-nums text-(--c-ink5b)">{t}</div>
                  ))}
                </div>
                <div className="relative h-[536px] flex-1">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {footer}
      <Nav active={1} />
    </Phone>
  )
}

function OutOfTermScreen() {
  return (
    <WeekShell
      week="第 21 周"
      right="超出学期"
      month="1月"
      strip={[['19', '周一'], ['20', '周二'], ['21', '周三'], ['22', '周四'], ['23', '周五'], ['24', '周六']]}
      footer={
        <div className="absolute inset-x-4 bottom-[104px] z-[9] rounded-[1.5rem] px-4 py-3.5" style={dockStyle}>
          <div className="text-[14px] font-bold text-(--c-ink)">秋季学期只有 20 周</div>
          <div className="mt-1 text-[12.5px] leading-[1.5] font-medium text-(--c-ink3)">到 1 月 18 日结束，第 21 周起没有安排。</div>
          <div className="mt-3.5 flex items-center justify-between">
            <span className="text-[13px] font-bold text-(--c-ink3)">导入下学期</span>
            <span className="text-[13px] font-bold text-(--c-accent)">回到第 7 周</span>
          </div>
        </div>
      }
    >
      <div className="absolute inset-x-0 top-[150px] flex flex-col items-center">
        <div className="text-[12.5px] font-semibold text-(--c-ink5)">学期已结束</div>
      </div>
    </WeekShell>
  )
}

function VacationScreen() {
  return (
    <WeekShell
      week="第 5 周"
      right="国庆假期"
      month="10月"
      rightTone="amber"
      strip={[['1', '周三'], ['2', '周四'], ['3', '周五'], ['4', '周六'], ['5', '周日'], ['6', '周一']]}
      footer={
        <div className="absolute inset-x-4 bottom-[104px] z-[9] rounded-[1.5rem] px-4 py-3.5" style={dockStyle}>
          <div className="text-[14px] font-bold text-(--c-ink)">10月1日–10月7日 放假</div>
          <div className="mt-1 text-[12.5px] leading-[1.5] font-medium text-(--c-ink3)">假期占周次，下一周仍为第 6 周、双周。</div>
          <div className="mt-3 space-y-1.5">
            {([
              ['高等数学（下）', '周四 1–2 节，停课'],
              ['数据结构', '周五 5–6 节，停课'],
            ] as [string, string][]).map(([n, s]) => (
              <div key={n} className="flex items-baseline justify-between">
                <span className="text-[12.5px] font-semibold text-(--c-ink2) line-through">{n}</span>
                <span className="text-[11.5px] font-medium text-(--c-ink4)">{s}</span>
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-(--c-ink4)">假期来自规则设置</span>
            <span className="text-[13px] font-bold text-(--c-accent)">跳到 10月8日</span>
          </div>
        </div>
      }
    >
      <div className="absolute inset-x-0 top-[150px] flex flex-col items-center">
        <div className="text-[12.5px] font-semibold text-(--c-ink5)">假期，没有课</div>
      </div>
    </WeekShell>
  )
}

const exams: [string, string, string, string, string, string][] = [
  ['高等数学（下）', '1月6日 周二', '09:00–11:00', '教学三楼 302', '座位 24', '3 天后'],
  ['数据结构', '1月8日 周四', '14:30–16:30', '教学一楼 201', '座位 07', ''],
  ['大学物理', '1月9日 周五', '09:00–11:00', '理科楼 A203', '座位 31', ''],
]
const examColors = [C.math, C.ds, C.phy]

function ExamWeekScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="flex items-center justify-between px-5">
          <div className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">
            第 19 周
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <div className="text-[12.5px] font-semibold text-(--c-accent)">考试周</div>
        </div>
        <div className="mt-2 px-5 text-[12.5px] font-medium text-(--c-ink3)">本周 3 场考试</div>

        <div className="mt-4 px-5">
          <div className="space-y-2.5">
            {exams.map(([name, day, time, loc, seat, cd], i) => {
              const color = examColors[i]
              return (
                <div key={name} className="rounded-[16px] bg-(--c-surface) px-4 py-3.5">
                  <div className="flex items-start justify-between">
                    <div className="flex min-w-0 items-center">
                      <i className="mr-3 h-[16px] w-[3px] flex-none rounded-full" style={{ background: color }} />
                      <span className="truncate text-[15px] font-bold tracking-[-.01em] text-(--c-ink)">{name}</span>
                    </div>
                    {cd ? (
                      <span className="ml-2 flex-none rounded-[7px] bg-(--c-accent-soft) px-2 py-[3px] text-[10.5px] font-bold text-(--c-accent)">{cd}</span>
                    ) : (
                      <span className="ml-2 flex-none text-[11.5px] font-semibold tabular-nums text-(--c-ink4b)">{day.slice(0, 4)}</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 pl-[15px]">
                    <span className="text-[13px] font-bold tabular-nums text-(--c-ink)">{day} {time}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2 pl-[15px] text-[12px] font-medium text-(--c-ink3)">
                    <span>{loc}</span>
                    <span className="h-3 w-px bg-(--c-line)" />
                    <span className="tabular-nums">{seat}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
            <div className="text-[13px] font-bold text-(--c-ink)">还有 2 门没有考试安排</div>
            <div className="mt-1 text-[12px] leading-[1.5] font-medium text-(--c-ink3)">大学英语（三）、形势与政策。</div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-(--c-ink4)">考试安排为手动添加</span>
              <span className="text-[13px] font-bold text-(--c-accent)">添加考试</span>
            </div>
          </div>
        </div>
      </div>
      <Nav active={1} />
    </Phone>
  )
}

/* ---------------- edit one session / manual add ---------------- */

function Chips({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="flex gap-1.5">
      {items.map((t, i) => (
        <span
          key={t}
          className={`rounded-[9px] px-2.5 py-[6px] text-[12px] font-bold ${i === active ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-surface) text-(--c-ink3)'}`}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

function Field({ k, v, sub, muted }: { k: string; v: string; sub?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline px-4 py-3">
      <span className="w-[62px] flex-none text-[12.5px] font-medium text-(--c-ink4)">{k}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-semibold ${muted ? 'text-(--c-ink4b)' : 'text-(--c-ink)'}`}>{v}</div>
        {sub && <div className="mt-1 text-[11.5px] font-medium text-(--c-ink4)">{sub}</div>}
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.4" className="ml-2 flex-none self-center"><path d="m9 5 7 7-7 7" /></svg>
    </div>
  )
}

function EditSessionScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="编辑课程" sub="线性代数，10月16日 周四 5–6 节" />

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">生效范围</div>
        <div className="mt-2.5">
          <Chips items={['仅本次', '每周']} active={0} />
        </div>

        <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">详情</div>
        <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Field k="状态" v="正常上课" sub="可改为请假、停课或调课" />
          <Field k="时间" v="14:00 – 15:40" sub="5–6 节" />
          <Field k="地点" v="教学三楼 110" />
          <Field k="老师" v="赵一鸣" />
          <Field k="备注" v="带上上次的习题册" />
        </div>

        <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">快捷操作</div>
        <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          {([
            ['请假一次', '出勤记一次缺勤'],
            ['这节停课', '仅移除这一次，不影响其他周'],
            ['调整时间', '选新的日期和节次，保留一条变更记录'],
          ] as [string, string][]).map(([t, d]) => (
            <div key={t} className="flex items-center px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-(--c-ink)">{t}</div>
                <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink4)">{d}</div>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.4" className="ml-2 flex-none"><path d="m9 5 7 7-7 7" /></svg>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-[12px] font-medium text-(--c-ink4b)">手动改动不被导入覆盖</span>
          <div className="flex items-center gap-5">
            <span className="text-[13px] font-bold text-(--c-ink3)">取消</span>
            <span className="text-[13px] font-bold text-(--c-accent)">保存</span>
          </div>
        </div>
      </div>
    </Phone>
  )
}

function ManualAddScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-5 pt-12">
        <TopBar title="手动添加" />

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">类型</div>
        <div className="mt-2.5">
          <Chips items={['课程', '自习', '考试', '其他']} active={1} />
        </div>

        <div className="mt-4 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Field k="名称" v="数据结构复习" />
          <Field k="时间" v="周三 19:00 – 21:00" sub="不占节次，按钟点安排" />
          <Field k="地点" v="图书馆 3 层 自习区" />
          <Field k="重复" v="每周三，到第 16 周" sub="也可只加这一次" />
          <Field k="提醒" v="开始前 15 分钟" />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <span className="text-[12.5px] font-medium text-(--c-ink4)">颜色</span>
          <div className="flex items-center gap-2.5">
            {[C.la, C.ds, C.eng, C.phy, C.pol, '#8A8E97'].map((c, i) => (
              <span
                key={c}
                className="flex h-[19px] w-[19px] items-center justify-center rounded-full"
                style={{ background: tint(c, 22), boxShadow: i === 0 ? `inset 0 0 0 1.6px ${c}` : undefined }}
              >
                <i className="h-[7px] w-[7px] rounded-full" style={{ background: c }} />
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <div className="text-[12.5px] font-semibold text-(--c-ink3)">预览</div>
          <div className="mt-2.5 flex items-center rounded-[12px] px-3.5 py-3" style={{ background: tint(C.la, 8) }}>
            <i className="mr-3 h-[34px] w-[3px] flex-none rounded-full" style={{ background: C.la }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold text-(--c-ink)">数据结构复习</div>
              <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink3)">周三 19:00–21:00　图书馆 3 层</div>
            </div>
          </div>
          <div className="mt-2.5 text-[11.5px] leading-[1.5] font-medium text-(--c-ink4b)">和周三的课不冲突。</div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-5 px-1">
          <span className="text-[13px] font-bold text-(--c-ink3)">取消</span>
          <span className="text-[13px] font-bold text-(--c-accent)">添加</span>
        </div>
      </div>
    </Phone>
  )
}

/* ---------------- command palette search ---------------- */

const searchGroups: [string, [string, string, string, string][]][] = [
  ['课程', [
    ['线性代数', '周四 5–6 节，教学三楼 110', '赵一鸣', C.la],
    ['线性代数习题课', '周二 9–10 节，教学三楼 110', '选到课', C.la],
  ]],
  ['老师', [
    ['赵一鸣', '线性代数、线代习题课，2 门', '', C.la],
  ]],
  ['教室', [
    ['教学三楼 110', '线性代数、线代习题课，本周 3 节', '', '#8A8E97'],
  ]],
]

function SearchScreen() {
  return (
    <Phone>
      <div className="flex-1 overflow-hidden px-4 pt-12">
        <div className="flex items-center rounded-full bg-(--c-surface) px-4 py-2.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.2" className="mr-2.5 flex-none"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
          <span className="text-[14px] font-medium text-(--c-ink)">线</span>
          <i className="ml-[1px] h-[15px] w-[1.5px] bg-(--c-accent)" />
          <span className="ml-auto flex-none text-[12.5px] font-medium text-(--c-ink3)">取消</span>
        </div>

        <div className="mt-3 space-y-3.5">
          {searchGroups.map(([g, rows]) => (
            <div key={g}>
              <div className="px-1.5 text-[11.5px] font-medium text-(--c-ink4)">{g}</div>
              <div className="mt-1.5 overflow-hidden rounded-[14px] bg-(--c-surface) p-1">
                {rows.map(([name, meta, right], i) => (
                  <div key={name} className={`flex items-center rounded-[10px] px-2.5 py-2.5 ${g === '课程' && i === 0 ? 'bg-(--c-line2)' : ''}`}>
                    <i className="mr-3 h-[26px] w-[3px] flex-none rounded-full" style={{ background: rows[i][3] }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-(--c-ink)">
                        {name.split('线').map((part, k) => (
                          <React.Fragment key={k}>
                            {k > 0 && <span className="bg-(--c-accent-soft) text-(--c-accent)">线</span>}
                            {part}
                          </React.Fragment>
                        ))}
                      </div>
                      <div className="mt-[2px] truncate text-[11.5px] font-medium text-(--c-ink4)">{meta}</div>
                    </div>
                    {right && <span className="ml-2 flex-none text-[11.5px] font-medium text-(--c-ink4b)">{right}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  )
}

/* ---------------- long press quick menu ---------------- */

const pressMenu: [React.ReactNode, string, string][] = [
  [<g key="b"><path d="M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6z" /><path d="M4 4l16 16" /></g>, '静音本节', '仅本次不提醒'],
  [<g key="c"><path d="M20 6 9 17l-5-5" /></g>, '标记已上', '计入出勤，13 → 14 课时'],
  [<g key="l"><rect x="3.5" y="4" width="17" height="16" rx="4" /><path d="M9 12h6" /></g>, '请假一次', '出勤记一次缺勤'],
  [<g key="h"><path d="M4 17V7M20 17V7" /><path d="m8 13 4-4 4 4" /></g>, '变更记录', '共 2 条'],
  [<g key="e"><path d="M4 20h4L20 8l-4-4L4 16z" /></g>, '编辑课程', '时间、地点、备注'],
]

function LongPressScreen() {
  const col = 1
  const evTop = 84
  return (
    <Phone>
      <div className="flex-1 overflow-hidden pt-12">
        <div className="flex items-center justify-between px-5">
          <div className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em] text-(--c-ink)">
            第 7 周
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink4)" strokeWidth="2.6"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <div className="flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            <span>单周</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span>秋季学期</span>
          </div>
        </div>

        <div className="mt-3.5 px-2">
          <div className="rounded-[22px] bg-(--c-surface) p-2.5 pb-4">
            <DayPicker
              active={todayIndex}
              lead={<div className="-mr-[5px] flex w-8 flex-none items-center justify-center text-[10.5px] font-semibold text-(--c-ink4)">10月</div>}
            />
            <div className="relative mt-2">
              {[0, 84, 168, 252, 336, 420, 504].map((t) => (
                <div key={t} className="absolute right-0 left-8 h-px bg-(--c-line2)" style={{ top: t + 6 }} />
              ))}
              <div className="flex pt-1.5">
                <div className="w-8 flex-none">
                  {['8:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((t) => (
                    <div key={t} className="h-[84px] pr-1.5 text-right text-[9.5px] font-semibold tabular-nums text-(--c-ink4b)">{t}</div>
                  ))}
                </div>
                <div className="relative flex h-[536px] flex-1 gap-[5px]">
                  {weekCols.map((c, i) => (
                    <div key={i} className="relative flex-1">
                      {c.map((ev) => {
                        const pressed = i === col && ev.top === evTop
                        return (
                          <div
                            key={ev.name + ev.top}
                            className="absolute inset-x-0 overflow-hidden rounded-[9px] px-1 py-1.5 text-[9.5px] leading-[1.35] font-bold"
                            style={{
                              top: ev.top,
                              height: ev.h,
                              background: tint(ev.color, pressed ? 20 : 10),
                              color: `color-mix(in srgb, ${ev.color} 85%, var(--c-ink-mix))`,
                              boxShadow: pressed ? `inset 0 0 0 1.5px ${ev.color}, var(--c-lift-shadow)` : undefined,
                              transform: pressed ? 'scale(1.06)' : undefined,
                              zIndex: pressed ? 40 : undefined,
                            }}
                          >
                            {ev.name}
                            <div className="mt-0.5 text-[8.5px] leading-[1.3] font-semibold opacity-60">{ev.loc}</div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 z-30 bg-(--c-bg)/72" />

      <div className="absolute top-[318px] right-4 z-40 w-[226px] overflow-hidden rounded-[17px] border border-(--c-line) bg-(--c-surface) py-2" style={{ boxShadow: 'var(--c-menu-shadow)' }}>
        <div className="px-3.5 pt-1 pb-2.5">
          <div className="truncate text-[12.5px] font-medium text-(--c-ink4)">高等数学（下）　10:00</div>
        </div>
        {pressMenu.map(([ic, t], i) => (
          <div key={t} className={`mx-2 flex items-center rounded-[11px] px-2.5 py-[9px] ${i === 0 ? 'bg-(--c-line2)' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-ink2)" strokeWidth="1.7" strokeLinecap="round" className="mr-3 h-[17px] w-[17px] flex-none">{ic}</svg>
            <span className="truncate text-[14px] font-medium text-(--c-ink)">{t}</span>
          </div>
        ))}
        <div className="mx-2 mt-0.5 flex items-center rounded-[11px] px-2.5 py-[9px]">
          <svg viewBox="0 0 24 24" fill="none" stroke="#C25B5B" strokeWidth="1.7" strokeLinecap="round" className="mr-3 h-[17px] w-[17px] flex-none"><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></svg>
          <span className="text-[14px] font-medium text-(--c-danger)">本节停课</span>
        </div>
      </div>

      <Nav active={1} />
    </Phone>
  )
}

const screens: [string, string, () => React.ReactElement][] = [
  ['today', '今天', () => <TodayScreen />],
  ['today-cal', '今天 · 日期选择', () => <TodayScreen overlay={<CalendarSheet mode="day" />} />],
  ['week', '本周课表', () => <WeekScreen />],
  ['week-cal', '本周 · 周次选择', () => <WeekScreen overlay={<CalendarSheet mode="week" />} />],
  ['detail', '课程详情', () => <DetailScreen />],
  ['add', '规则导入', () => <AddScreen />],
  ['link', '链接添加规则', () => <LinkScreen />],
  ['airule', 'AI 生成规则', () => <AiRuleScreen />],
  ['todo', '待办', () => <TodoScreen />],
  ['me', '我的', () => <MeScreen />],
  ['lock', '锁屏', () => <LockScreen />],
  ['notif', '通知偏好', () => <NotifPrefScreen />],
  ['widget', '桌面小组件', () => <WidgetScreen />],
  ['widget2', '小组件样式', () => <WidgetScreen2 />],
  ['freeday', '今天没有课', () => <FreeDayScreen />],
  ['nodata', '还没有课表', () => <NoDataScreen />],
  ['partialfail', '部分导入失败', () => <PartialFailScreen />],
  ['conflict', '课程冲突', () => <ConflictScreen />],
  ['conflict-pick', '冲突 · 只留一门', () => <ConflictScreen mode="pick" />],
  ['change', '调课差异', () => <ChangeScreen />],
  ['outofterm', '超出学期', () => <OutOfTermScreen />],
  ['vacation', '假期周', () => <VacationScreen />],
  ['examweek', '考试周', () => <ExamWeekScreen />],
  ['edit', '编辑课程', () => <EditSessionScreen />],
  ['manualadd', '手动添加', () => <ManualAddScreen />],
  ['search', '搜索', () => <SearchScreen />],
  ['longpress', '长按菜单', () => <LongPressScreen />],
]

export default function App() {
  const one = new URLSearchParams(window.location.search).get('s')
  if (one) {
    const hit = screens.find(([k]) => k === one)
    return <div className="p-0">{hit ? hit[2]() : null}</div>
  }
  const q = new URLSearchParams(window.location.search)
  const zoom = Number(q.get('z') || 1)
  const g = Number(q.get('g') || 0)
  const batch = g ? screens.slice((g - 1) * 5, g * 5) : screens
  return (
    <div className="flex w-max items-start gap-9 p-10" style={{ zoom }}>
      {batch.map(([k, , render]) => (
        <div key={k} className="flex w-[375px] flex-none flex-col">{render()}</div>
      ))}
    </div>
  )
}
