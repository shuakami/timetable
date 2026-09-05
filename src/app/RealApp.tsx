import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { flushSync } from 'react-dom'
import { App as CapApp } from '@capacitor/app'
import type { Course, Occurrence, Semester, SessionRule, Task, OverrideKind, WidgetStyle } from '../domain/types'
import { addDays, fmtDuration, fmtMinutes, inVacation, weekOf, weekdayOf, dateOf } from '../domain/dates'
import { maskHasWeek, maskToWeeks } from '../domain/weeks'
import { occurrencesOn, occurrencesInWeek, type Snapshot } from '../domain/engine'
import { normalize } from '../domain/importer'
import type { NormalizedCourse, RuleOutput } from '../domain/importer'
import { runRule, type RuleManifest, type RuleInputKind, DEFAULT_CSV_MAPPING } from '../domain/rules'
import { fetchUrl } from '../domain/importers/url'
import { AI_IMPORT_PROMPT } from '../domain/ai-prompt'
import { uid, type Store, type State } from '../domain/store'
import { store, useStore } from './store'
import { defaultSemester, mondayOf, nowMinutes, todayStr } from './semester'
import Onboarding, { currentWeek } from './Onboarding'
import {
  ChangePage, ConflictPage, CourseDetailPage, CourseEditPage, EditSessionPage,
  ManualAddPage,
} from './pages'
import { CameraPage, ClassEndCard, ComposeOverlay, PickerPage, ReviewPage, TaskDetailPage, TodoView, cameraLeave } from './todo'
import { camera, loadPhotoSrc, nativeCamera, photoSrc, rememberPhoto, type CapturedPhoto } from './camera'
import { justEndedClass } from '../domain/next-class'
import { CalendarIntroPage, NotifPrefPage, PrefPickPage, WidgetPage, taskLeadsText, type PrefKey } from './reminder'
import { calendarPermission, calendarSupported, clearCalendar, scheduleCalendarSync, syncCalendar } from './calendar'
import { nativeToast, syncWidgets } from './widgets'
import { onIncomingIcs, shareIcs } from './files'
import { THEME_LABEL, resolve, setDynamic, setTheme, useDynamic, useTheme, type ThemePref } from './theme'
import {
  ActionSheet, BackPill, BottomVeil, Chips, EmptyBlock, closeTopSheet, Field, FADE, ICON, Nav, Page, PopHead, PopItem, Popover, PrimaryButton, Row, SHEET, SLIDE, SPRING, Sheet, StickyHead, TopVeil, useVeilOpacity,
  TextAction, TextInput, TopBar, WD, WD_SHORT, dockStyle, md, tint, type Ghost, type Rect,
  DateInput, TimeInput,
} from './ui'

/* ---------------- 壳 ---------------- */

function Shell({ children, tab, onTab, navHidden }: { children: React.ReactNode; tab: number; onTab: (i: number) => void; navHidden?: boolean }) {
  return (
    <div data-shell className="relative mx-auto flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-(--c-bg) font-sans text-(--c-ink)">
      {children}
      <Nav active={tab} onTab={onTab} hidden={navHidden} />
    </div>
  )
}

function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
      <svg viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink2)' }} strokeWidth="2" strokeLinecap="round" className="h-[16px] w-[16px]"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.2-3.2" /></svg>
    </button>
  )
}

/* 轻点进详情，长按弹快捷菜单（坐标换算到外层壳） */
let pressTimer: number | null = null
let pressFired = false
let pressAt = { x: 0, y: 0 }

function clearPress() {
  if (pressTimer != null) {
    window.clearTimeout(pressTimer)
    pressTimer = null
  }
}

function pressProps(onTap: () => void, onLong: (r: Rect, el: HTMLElement) => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      pressFired = false
      pressAt = { x: e.clientX, y: e.clientY }
      const target = e.currentTarget as HTMLElement
      const el = target.querySelector<HTMLElement>('[data-lift]') ?? target
      const shell = el.closest('[data-shell]')?.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const rect: Rect = {
        x: box.left - (shell?.left ?? 0),
        y: box.top - (shell?.top ?? 0),
        w: box.width,
        h: box.height,
      }
      clearPress()
      pressTimer = window.setTimeout(() => {
        pressFired = true
        pressTimer = null
        onLong(rect, el)
      }, 420)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pressTimer != null && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) clearPress()
    },
    onPointerUp: () => {
      const pending = pressTimer != null
      clearPress()
      if (pending && !pressFired) onTap()
    },
    onPointerCancel: clearPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}

/* ---------------- 日期条 + 月历 ---------------- */

/* 日期条：整学期连续横向滚动（原生惯性），选中项居中；只在关掉日历重新出现时播出场动画 */
function DateStrip({ snap, anchor, onPick, onCalendar }: { snap: Snapshot; anchor: string; onPick: (d: string) => void; onCalendar: () => void }) {
  const today = todayStr()
  const sem = snap.semester
  const days = useMemo(() => {
    const lo = [mondayOf(sem.startDate), mondayOf(addDays(today, -28)), mondayOf(anchor)].sort()[0]
    const hi = [addDays(sem.startDate, sem.totalWeeks * 7 + 6), addDays(today, 34), addDays(anchor, 6)].sort().pop()!
    const out: string[] = []
    for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d)
    return out
  }, [sem, today, anchor])
  const box = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => {
    const sc = box.current
    const el = sc?.querySelector<HTMLElement>(`[data-d="${anchor}"]`)
    if (!sc || !el) return
    const left = el.offsetLeft - (sc.clientWidth - el.offsetWidth) / 2
    sc.scrollTo({ left, behavior: first.current ? 'auto' : 'smooth' })
    first.current = false
  }, [anchor, days])
  return (
    <motion.div
      initial={{ y: 26, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 26, opacity: 0 }}
      transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
      className="absolute inset-x-4 bottom-[calc(80px+max(24px,env(safe-area-inset-bottom)))] z-[9] flex items-stretch rounded-[1.5rem] py-1.5 pr-1"
      style={dockStyle}
    >
      <div
        ref={box}
        className="flex flex-1 items-stretch gap-[5px] overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent)' }}
      >
        {days.map((d) => {
          const on = d === anchor
          const past = d < today && !on
          const n = occurrencesOn(snap, d).length
          const monthStart = d.slice(8) === '01'
          return (
            <button key={d} data-d={d} onClick={() => onPick(d)} className="relative flex w-[46px] flex-none flex-col items-center py-[5px]" style={{ scrollSnapAlign: 'center' }}>
              {on && (
                <motion.i
                  layoutId="date-strip-indicator"
                  transition={SPRING}
                  className="absolute inset-x-[-2px] inset-y-0 rounded-[13px] bg-(--c-accent-soft)"
                />
              )}
              <span
                className={`relative z-10 text-[17px] leading-[1.2] font-bold tabular-nums ${on ? 'text-(--c-accent)' : past ? 'text-(--c-ink5)' : 'text-(--c-ink)'}`}
              >{Number(d.slice(8))}</span>
              <span className={`relative z-10 mt-0.5 text-[10.5px] font-semibold ${on ? 'text-(--c-accent)' : past ? 'text-(--c-ink5)' : 'text-(--c-ink4)'}`}>
                {d === today ? '今天' : monthStart ? `${Number(d.slice(5, 7))}月` : WD[weekdayOf(d)]}
              </span>
              {n > 0 && <span className={`absolute top-[3px] right-[2px] z-10 text-[9px] font-bold tabular-nums ${on ? 'text-(--c-accent2)' : past ? 'text-(--c-line)' : 'text-(--c-ink5)'}`}>{n}</span>}
            </button>
          )
        })}
      </div>
      <button onClick={onCalendar} className="flex w-9 flex-none items-center justify-center">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink2)' }} strokeWidth="1.9"><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
      </button>
    </motion.div>
  )
}

/** 一个月的网格：只在月份 / 课程数 / 选中 / 模式变化时重渲染，滚动不碰它 */
const MonthGrid = memo(function MonthGrid({ month, sem, counts, anchor, today, mode, onPick }: {
  month: string
  sem: Semester
  counts: Map<string, number>
  anchor: string
  today: string
  mode: 'day' | 'week'
  onPick: (d: string) => void
}) {
  const rows = useMemo(() => {
    const lead = weekdayOf(`${month}-01`) - 1
    const total = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    const cells: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    const out: (string | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [month])
  const rowWeek = (row: (string | null)[]) => {
    const d = row.find(Boolean)
    return d ? weekOf(sem, d) : 0
  }
  const anchorWeek = weekOf(sem, anchor)
  return (
    <div className="space-y-[3px]">
      {rows.map((row, ri) => {
        const wk = rowWeek(row)
        const rowOn = mode === 'week' && wk === anchorWeek
        return (
          <div key={ri} className={`flex gap-[5px] rounded-[12px] ${rowOn ? 'bg-(--c-accent-soft)' : ''}`}>
            <div className="flex w-7 flex-none items-center justify-center">
              <span className={`text-[10.5px] font-bold tabular-nums ${rowOn ? 'text-(--c-accent)' : 'text-(--c-ink5)'}`}>{wk >= 1 && wk <= sem.totalWeeks ? wk : ''}</span>
            </div>
            {row.map((d, ci) => {
              if (!d) return <div key={ci} className="flex-1" />
              const n = counts.get(d) ?? 0
              const isToday = d === today
              const sel = d === anchor
              return (
                <button key={d} onClick={() => onPick(d)} className="relative flex flex-1 flex-col items-center py-[9px]">
                  {sel && <i className="absolute inset-x-[-4px] inset-y-0 rounded-[13px] bg-(--c-accent-soft)" />}
                  <span
                    className={`relative z-10 flex h-[22px] w-[22px] items-center justify-center text-[15px] leading-none font-bold tabular-nums ${
                      isToday || sel ? 'text-(--c-accent)' : n ? 'text-(--c-ink)' : 'text-(--c-ink5)'
                    }`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <span className={`relative z-10 mt-1 h-[3px] w-[3px] rounded-full ${n ? (isToday || sel ? 'bg-(--c-accent)' : 'bg-(--c-ink5)') : 'bg-transparent'}`} />
                  {n > 0 && <span className={`absolute top-[3px] right-[2px] z-10 text-[9px] font-bold tabular-nums ${isToday || sel ? 'text-(--c-accent2)' : 'text-(--c-ink5)'}`}>{n}</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
})

/** 月标题：吸顶后下沿出现羽化；只有这一小块跟着滚动位置重渲染 */
function MonthHead({ month, sem, stuck }: { month: string; sem: Semester; stuck: boolean }) {
  const first = weekOf(sem, `${month}-01`)
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const last = weekOf(sem, `${month}-${String(lastDay).padStart(2, '0')}`)
  return (
    <div className={`sticky top-0 z-[20] flex items-baseline gap-2.5 bg-(--c-surface) px-1 py-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-[linear-gradient(180deg,var(--c-surface),transparent)] after:transition-opacity after:duration-200 after:content-[''] ${stuck ? 'after:opacity-100' : 'after:opacity-0'}`}>
      <span className="text-[19px] font-extrabold tracking-[-.02em]">{Number(month.slice(5, 7))}月</span>
      <span className="text-[12px] font-semibold text-(--c-ink4)">
        {sem.name}
        {last >= 1 ? ` 第 ${Math.max(1, first)}–${Math.min(sem.totalWeeks, Math.max(1, last))} 周` : ''}
      </span>
    </div>
  )
}

function CalendarSheet({ snap, mode, anchor, onPick, onClose }: { snap: Snapshot; mode: 'day' | 'week'; anchor: string; onPick: (d: string) => void; onClose: () => void }) {
  const today = todayStr()
  const sem = snap.semester
  const scrollRef = useRef<HTMLDivElement>(null)
  const marks = useRef<Record<string, HTMLDivElement>>({})
  const dismiss = useRef<(() => void) | null>(null)
  /** 选日期后先播完抽屉退出动画，再由 onExitComplete 卸载 */
  const pick = useCallback((d: string) => { onPick(d); dismiss.current?.() }, [onPick])

  /** 学期覆盖到的月份，连续排列，直接上下滚动 */
  const months = useMemo(() => {
    const out: string[] = []
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const end = new Date(`${addDays(sem.startDate, sem.totalWeeks * 7 - 1)}T00:00:00`)
    const cur = new Date(`${sem.startDate}T00:00:00`)
    cur.setDate(1)
    while (cur <= end) {
      out.push(key(cur))
      cur.setMonth(cur.getMonth() + 1)
    }
    for (const m of [anchor.slice(0, 7), today.slice(0, 7)]) if (!out.includes(m)) out.push(m)
    return out.sort()
  }, [sem, anchor, today])

  /** 每天的课程数：整个范围算一次，格子里只查表 */
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const lo = `${months[0]}-01`
    const hiM = months[months.length - 1]
    const hi = `${hiM}-${String(new Date(Number(hiM.slice(0, 4)), Number(hiM.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
    for (let d = lo; d <= hi; d = addDays(d, 1)) {
      const n = occurrencesOn(snap, d).length
      if (n) m.set(d, n)
    }
    return m
  }, [snap, months])

  const scrollTo = (month: string) => {
    const node = marks.current[month]
    const box = scrollRef.current?.parentElement
    if (node && box) box.scrollTop = node.offsetTop - box.offsetTop
  }

  /** 哪个月标题正吸在顶上 */
  const [stuckMonth, setStuckMonth] = useState<string | null>(null)
  useEffect(() => {
    scrollTo(anchor.slice(0, 7))
    const box = scrollRef.current?.parentElement
    if (!box) return
    const onScroll = () => {
      const top = box.scrollTop
      let cur: string | null = null
      for (const m of months) {
        const node = marks.current[m]
        if (node && top > node.offsetTop - box.offsetTop + 1) cur = m
      }
      setStuckMonth(cur)
    }
    onScroll()
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-4"
      header={
        <div className="flex gap-[5px] px-4 pt-1 pb-2">
          <div className="w-7 flex-none" />
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <div key={w} className="flex-1 text-center text-[10.5px] font-semibold text-(--c-ink4)">{WD_SHORT[w]}</div>
          ))}
        </div>
      }
      footer={
        <div className="flex justify-end px-5 pt-3">
          <TextAction onClick={() => { scrollTo(today.slice(0, 7)); pick(today) }}>{mode === 'day' ? '今天' : '本周'}</TextAction>
        </div>
      }
    >
      <div ref={scrollRef} className="max-h-full">
        {months.map((month) => (
          <div
            key={month}
            ref={(el) => {
              if (el) marks.current[month] = el
            }}
            className="pb-4"
          >
            <MonthHead month={month} sem={sem} stuck={stuckMonth === month} />
            <MonthGrid month={month} sem={sem} counts={counts} anchor={anchor} today={today} mode={mode} onPick={pick} />
          </div>
        ))}
      </div>
    </Sheet>
  )
}

/* ---------------- 今天（跨日连续时间线） ---------------- */

function TodayView({
  snap, anchor, setAnchor, onPick, onMenu, onSearch, onImport, onManual, onCapture, liftKey,
}: {
  snap: Snapshot
  anchor: string
  setAnchor: (d: string) => void
  onPick: (o: Occurrence) => void
  onMenu: (o: Occurrence, r: Rect, el: HTMLElement) => void
  onSearch: () => void
  onImport: () => void
  onManual: () => void
  onCapture: (kind: 'camera' | 'text', courseId?: string) => void
  liftKey?: string
}) {
  const today = todayStr()
  const [now, setNow] = useState(nowMinutes)
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 30_000)
    return () => clearInterval(t)
  }, [])
  const [cal, setCal] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /* 底部日期条跟随滚动位置：滚到「明天」那段时选中项切到明天 */
  const [view, setView] = useState(anchor)
  useEffect(() => setView(anchor), [anchor])
  /* 某一天的段落在滚动容器里的顶部偏移（标题区下方对齐） */
  const dayTop = (sc: HTMLElement, el: HTMLElement) => {
    const headH = (sc.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0
    return el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - headH
  }
  const gliding = useRef(0)
  const onScroll = () => {
    const sc = scrollRef.current
    if (!sc) return
    if (gliding.current) {
      window.clearTimeout(gliding.current)
      gliding.current = window.setTimeout(() => { gliding.current = 0 }, 120)
      return
    }
    let cur = anchor
    if (sc.scrollTop > 4) {
      const line = sc.scrollTop + Math.min(sc.clientHeight * 0.3, 120)
      for (const el of Array.from(sc.querySelectorAll<HTMLElement>('[data-day]'))) {
        if (dayTop(sc, el) <= line) cur = el.dataset.day!
        else break
      }
    }
    setView(cur)
  }
  /* 点日期条：目标日已在时间线里就滚过去，不重建列表；不在才换锁定日 */
  const pickDay = (d: string) => {
    const sc = scrollRef.current
    const el = sc?.querySelector<HTMLElement>(`[data-day="${d}"]`)
    if (sc && el) {
      setView(d)
      gliding.current = window.setTimeout(() => { gliding.current = 0 }, 120)
      sc.scrollTo({ top: Math.max(0, dayTop(sc, el) - 8), behavior: 'smooth' })
    } else if (d === anchor) sc?.scrollTo({ top: 0, behavior: 'smooth' })
    else setAnchor(d)
  }

  const days = useMemo(() => {
    const out: { date: string; rel: string; occ: Occurrence[] }[] = []
    for (let i = 0; i < 14; i++) {
      const d = addDays(anchor, i)
      const occ = occurrencesOn(snap, d)
      const rel = d === today ? '今天' : d === addDays(today, 1) ? '明天' : d === addDays(today, 2) ? '后天' : WD[weekdayOf(d)]
      if (i === 0 || occ.length > 0) out.push({ date: d, rel, occ })
      if (out.reduce((n, x) => n + x.occ.length, 0) >= 14 && i >= 2) break
    }
    return out
  }, [snap, anchor, today])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [anchor])

  const week = weekOf(snap.semester, anchor)
  const vac = inVacation(snap.semester, anchor)
  const head = days[0]?.occ ?? []
  const remain = anchor === today ? head.filter((o) => o.end > now && o.status !== 'cancelled').length : head.length
  const inTerm = week >= 1 && week <= snap.semester.totalWeeks
  const nothingAtAll = snap.courses.length === 0 && snap.entries.length === 0
  /* 刚下课那一刻：时间线里那节课下面直接给出记录入口 */
  const ended = useMemo(() => justEndedClass(snap, today, now), [snap, today, now])
  const [endHidden, setEndHidden] = useState<string[]>([])
  const endKey = ended ? `${ended.date}-${ended.courseId}-${ended.start}` : ''
  const showEnd = ended && !endHidden.includes(endKey)
  const weekend = weekdayOf(anchor) >= 6

  return (
    <>
      <div
        ref={(el) => { scrollRef.current = el }}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto pb-[210px] [scrollbar-width:none]"
      >
        <StickyHead bleed={0} className="px-5">
          <div className="flex items-start justify-between">
            <h1 className="text-[26px] font-extrabold tracking-[-.02em]">
              {md(anchor)} <span className="font-bold text-(--c-ink5)">{WD[weekdayOf(anchor)]}</span>
            </h1>
            <SearchButton onClick={onSearch} />
          </div>
          <div className="mt-2 flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
            {inTerm ? <span>第 {week} 周</span> : <span>学期外</span>}
            <span className="h-3 w-px bg-(--c-line)" />
            <span>{week % 2 === 1 ? '单周' : '双周'}</span>
            <span className="h-3 w-px bg-(--c-line)" />
            {head.length > 0 ? (
              <span>{head.length} 节课{anchor === today && <span className="text-(--c-ink5)">，剩 {remain} 节</span>}</span>
            ) : (
              <span className="text-(--c-ink5)">{nothingAtAll ? '暂无课表' : '今天没有课'}</span>
            )}
          </div>
        </StickyHead>
        {vac && <div className="mx-5 mt-1 rounded-[16px] bg-(--c-surface) px-4 py-3 text-[13px] font-semibold text-[#9A7B3F]">{vac}</div>}

        {nothingAtAll ? (
          <div className="mt-16">
            <EmptyBlock
              kind="none"
              title="让课表就位"
              desc="一键导入，或是手动创建。随后的日程追踪与准时提醒，皆会为你准备就绪。"
              actions={[['导入课表', onImport], ['手动添加', onManual]]}
            />
          </div>
        ) : head.length === 0 && days.length === 1 ? (
          <div className="mt-14">
            <EmptyBlock
              kind="free"
              title="今天没有课，好耶"
              desc={weekend ? '周末到了，不如去做点感兴趣的事，出去走走。' : '不如去做点感兴趣的事，出去走走。'}
              actions={[['手动添加', onManual]]}
            />
          </div>
        ) : (
          <div className="mt-6 px-5">
            {days.map((day, di) => {
              /* 今天里第一节还没开始的课：给出「下一节」提示，和原型一致 */
              const nextKey = day.date === today
                ? day.occ.find((x) => x.start > now && x.status !== 'cancelled')?.key
                : undefined
              return (
              <div key={day.date} data-day={day.date}>
                {day.occ.length > 0 && (
                  <div className="flex items-baseline justify-between pb-7">
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-[17px] leading-none font-extrabold tracking-[-.02em]">{day.rel}</span>
                      <span className="text-[12.5px] font-semibold text-(--c-ink4)">{md(day.date)}{day.rel !== WD[weekdayOf(day.date)] ? ` ${WD[weekdayOf(day.date)]}` : ''}</span>
                    </div>
                    <span className="text-[12px] font-semibold tabular-nums text-(--c-ink5)">{day.occ.length} 节课，{fmtMinutes(day.occ[0].start)} 开始</span>
                  </div>
                )}
                {day.occ.length === 0 && di === 0 && (
                  <div className="pb-7 text-[13.5px] font-semibold text-(--c-ink4)">无课程</div>
                )}
                {day.occ.map((o, oi) => {
                  const isLast = oi === day.occ.length - 1
                  const isToday = day.date === today
                  const past = (isToday && o.end <= now) || day.date < today
                  const nowOn = isToday && o.start <= now && now < o.end
                  const pct = ((now - o.start) / Math.max(1, o.end - o.start)) * 100
                  return (
                    <Fragment key={o.key}>
                    <div className="relative -mx-3 w-[calc(100%+24px)] rounded-[18px]">
                    <button
                      {...pressProps(() => onPick(o), (r, el) => onMenu(o, r, el))}
                      className={`flex w-full px-3 py-2 text-left transition-transform duration-150 ${liftKey === o.key ? '' : 'active:scale-[.985]'}`}
                    >
                      <div className={`w-11 flex-none pt-0.5 ${past ? 'opacity-50' : ''}`}>
                        <div className="text-[11px] font-bold text-(--c-ink2)">{o.startPeriod === o.endPeriod ? `${o.startPeriod}节` : `${o.startPeriod}–${o.endPeriod}节`}</div>
                        <div className="mt-1 text-[11px] font-medium tabular-nums text-(--c-ink4)">{fmtMinutes(o.start)}</div>
                        <div className="text-[11px] font-medium tabular-nums text-(--c-ink5)">{fmtMinutes(o.end)}</div>
                      </div>
                      {/* 时间轴在一天里贯穿，最后一节下方留出与日期标题下方等高的空白 */}
                      <div className={`-my-2 ml-3 w-[2px] flex-none self-stretch ${isLast ? 'pb-7' : ''}`}>
                        <div className="relative h-full bg-(--c-line)">
                          {past && <i className="absolute inset-0 bg-(--c-accent)" />}
                          {nowOn && (
                            <>
                              <i className="absolute inset-x-0 top-0 bg-(--c-accent)" style={{ height: `${pct}%` }} />
                              <i className="absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-(--c-accent) bg-(--c-surface)" style={{ top: `${pct}%` }} />
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`flex-1 pb-7 pl-4 ${past || o.status === 'cancelled' ? 'opacity-50' : ''}`}>
                      <div data-lift>
                        <div className="flex items-start justify-between">
                          <div className={`text-[16px] leading-[1.25] font-bold tracking-[-.01em] ${o.status === 'cancelled' ? 'line-through' : ''}`}>{o.name}</div>
                          {o.conflict && <span className="ml-2 flex-none rounded-[7px] bg-(--c-amber-soft) px-2 py-[3px] text-[10.5px] font-bold text-(--c-amber)">冲突</span>}
                          {o.status === 'moved' && <span className="ml-2 flex-none rounded-[7px] bg-(--c-accent-soft) px-2 py-[3px] text-[10.5px] font-bold text-(--c-accent)">已调课</span>}
                          {!nowOn && o.key === nextKey && (
                            <span className="ml-2 flex-none rounded-[7px] bg-(--c-accent-soft) px-2 py-[3px] text-[10.5px] font-bold tabular-nums text-(--c-accent)">还有 {fmtDuration(o.start - now)}</span>
                          )}
                          {o.status === 'cancelled' && <span className="ml-2 flex-none rounded-[7px] bg-(--c-surface2) px-2 py-[3px] text-[10.5px] font-bold text-(--c-ink3)">停课</span>}
                          {o.status === 'leave' && <span className="ml-2 flex-none rounded-[7px] bg-(--c-rose-soft) px-2 py-[3px] text-[10.5px] font-bold text-(--c-rose)">请假</span>}
                          {(o.status === 'done' || (past && o.status === 'normal')) && <span className="ml-2 flex-none rounded-[7px] bg-(--c-surface2) px-2 py-[3px] text-[10.5px] font-bold text-(--c-ink3)">已上</span>}
                          {o.muted && o.status === 'normal' && !past && <span className="ml-2 flex-none rounded-[7px] bg-(--c-surface2) px-2 py-[3px] text-[10.5px] font-bold text-(--c-ink3)">静音</span>}
                        </div>
                        <div className="mt-1 text-[12.5px] font-medium text-(--c-ink3)">{[o.location, o.teacher].filter(Boolean).join('，') || '—'}</div>
                        {nowOn && <div className="mt-1.5 text-[12px] font-bold tabular-nums text-(--c-accent)">上课中，现在 {fmtMinutes(now)}，还剩 {fmtDuration(o.end - now)}</div>}
                        {!nowOn && o.key === nextKey && (
                          <div className="mt-1.5 text-[12px] font-semibold tabular-nums text-(--c-ink3)">下一节，{fmtMinutes(o.start)} 开始</div>
                        )}
                      </div>
                      </div>
                    </button>
                    </div>
                    {showEnd && ended && day.date === ended.date && o.courseId === ended.courseId && o.start === ended.start && (
                      <ClassEndCard
                        moment={ended}
                        onCamera={() => onCapture('camera', ended.courseId)}
                        onText={() => onCapture('text', ended.courseId)}
                        onDismiss={() => setEndHidden((s) => [...s, endKey])}
                      />
                    )}
                    </Fragment>
                  )
                })}
              </div>
              )
            })}
          </div>
        )}
      </div>

      <BottomVeil height={210} />
      <BackPill show={!cal && view !== today} label="回到今天" bottom="calc(152px + max(24px, env(safe-area-inset-bottom)))" onClick={() => pickDay(today)} />
      <AnimatePresence initial={false}>
        {!cal && <DateStrip snap={snap} anchor={view} onPick={pickDay} onCalendar={() => setCal(true)} />}
      </AnimatePresence>
      {cal && <CalendarSheet snap={snap} mode="day" anchor={anchor} onPick={setAnchor} onClose={() => setCal(false)} />}
    </>
  )
}

/* ---------------- 周视图 ---------------- */

const HOUR = 42
/* 卡片能读清课名与地点的最低高度；最短的课不够时放大整个时间轴，不单独拉高卡片 */
const MIN_CARD = 44
const MAX_HOUR = 120

/** 一周的日期条 + 时间网格；左右滑时相邻周也各渲染一份 */
function WeekGrid({ snap, week, anchor, today, now, setAnchor, onPick, onMenu, liftKey, gridRef, onGeometry }: {
  snap: Snapshot
  week: number
  anchor: string
  today: string
  now: number
  setAnchor: (d: string) => void
  onPick: (o: Occurrence) => void
  onMenu: (o: Occurrence, r: Rect, el: HTMLElement) => void
  liftKey?: string
  gridRef?: React.RefObject<HTMLDivElement>
  onGeometry?: (todayIdx: number, nowTop: number) => void
}) {
  const sem = snap.semester
  const byDay = useMemo(() => occurrencesInWeek(snap, week), [snap, week])
  const monday = dateOf(sem, week, 1)
  const days = [1, 2, 3, 4, 5, 6, 7].map((wd) => dateOf(sem, week, wd))
  const todayIdx = days.indexOf(today)

  /* 网格范围跟着真实课程走，晚课不会溢出白色区域 */
  const all = [...byDay.values()].flat()
  const dayStart = Math.min(8, ...all.map((o) => Math.floor(o.start / 60))) * 60
  const dayEnd = Math.max(20, ...all.map((o) => Math.ceil(o.end / 60))) * 60
  const hours: number[] = []
  for (let h = dayStart / 60; h <= dayEnd / 60; h += 2) hours.push(h)
  const shortest = Math.min(...all.map((o) => o.end - o.start).filter((m) => m > 0))
  const hour = Number.isFinite(shortest) ? Math.min(MAX_HOUR, Math.max(HOUR, Math.ceil(((MIN_CARD + 2) * 60) / shortest))) : HOUR
  const gridH = ((dayEnd - dayStart) / 60) * hour + 8
  const nowTop = ((now - dayStart) / 60) * hour
  useEffect(() => {
    onGeometry?.(todayIdx, nowTop)
  }, [todayIdx, nowTop, onGeometry])

  return (
    <>
      <div className="flex items-stretch gap-[5px]">
        <div className="-mr-[5px] flex w-8 flex-none items-center justify-center text-[10.5px] font-semibold text-(--c-ink4)">
          {Number(monday.slice(5, 7))}月
        </div>
        {days.map((d) => {
          const on = d === anchor
          const isToday = d === today
          const n = (byDay.get(weekdayOf(d)) ?? []).length
          return (
            <button key={d} onClick={() => setAnchor(d)} className="relative flex flex-1 flex-col items-center py-[5px]">
              {on && <motion.i layoutId="week-strip-indicator" transition={SPRING} className="absolute inset-x-[-4px] inset-y-0 rounded-[13px] bg-(--c-accent-soft)" />}
              <span className={`relative z-10 flex h-[24px] w-[24px] items-center justify-center text-[17px] leading-none font-bold tabular-nums ${isToday || on ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{Number(d.slice(8))}</span>
              <span className={`relative z-10 mt-0.5 text-[10.5px] font-semibold ${on || isToday ? 'text-(--c-accent)' : 'text-(--c-ink4)'}`}>{isToday ? '今天' : WD[weekdayOf(d)]}</span>
              {n > 0 && <span className={`absolute top-[3px] right-[2px] z-10 text-[9px] font-bold tabular-nums ${on ? 'text-(--c-accent2)' : 'text-(--c-ink5)'}`}>{n}</span>}
            </button>
          )
        })}
      </div>

      <div className="relative mt-2">
        {hours.map((h, i) => (
          <div key={h} className="absolute right-0 left-8 h-px bg-(--c-surface2)" style={{ top: i * 2 * hour + 6 }} />
        ))}
        <div className="flex pt-1.5">
          <div className="relative w-8 flex-none">
            {hours.map((h) => (
              <div key={h} className="pr-1.5 text-right text-[9.5px] font-semibold tabular-nums text-(--c-ink5)" style={{ height: 2 * hour }}>{h}:00</div>
            ))}
            {/* 时间刻度跟随真实课程范围 */}
            {todayIdx >= 0 && nowTop > 0 && hours.every((h) => Math.abs(now - h * 60) >= 20) && (
              <div className="absolute right-1.5 text-[9.5px] font-bold tabular-nums text-(--c-accent)" style={{ top: nowTop - 6 }}>{fmtMinutes(now)}</div>
            )}
          </div>
          <div ref={gridRef} className="relative flex flex-1 gap-[5px]" style={{ height: gridH }}>
            {days.map((d, i) => {
              const occ = byDay.get(weekdayOf(d)) ?? []
              const pastCol = d < today
              return (
                <div key={d} className={`relative flex-1 ${pastCol ? 'opacity-45' : ''}`}>
                  {occ.map((o) => {
                    const lanes = occ.filter((x) => x !== o && x.start < o.end && o.start < x.end)
                    const half = lanes.length > 0
                    const lane = half ? occ.filter((x) => x.start < o.end && o.start < x.end).indexOf(o) : 0
                    const done = d < today || (d === today && o.end <= now)
                    const nowOn = d === today && o.start <= now && now < o.end
                    const lift = liftKey === o.key
                    const ring = nowOn ? `inset 0 0 0 1.5px ${o.color}` : o.conflict ? 'inset 0 0 0 1.2px #D9A94B' : 'none'
                    return (
                      <div
                        key={o.key}
                        className="absolute"
                        style={{
                          top: ((o.start - dayStart) / 60) * hour,
                          height: ((o.end - o.start) / 60) * hour - 2,
                          left: half ? `${lane * 50}%` : 0,
                          width: half ? '50%' : '100%',
                        }}
                      >
                      <button
                        {...pressProps(() => onPick(o), (r, el) => onMenu(o, r, el))}
                        className={`relative h-full w-full overflow-hidden rounded-[9px] px-1 py-1.5 text-left text-[9.5px] leading-[1.35] font-bold transition-transform duration-150 ${lift ? '' : 'active:scale-[.97]'} ${o.status === 'cancelled' ? 'line-through' : ''}`}
                        style={{
                          background: tint(o.color, nowOn ? 22 : done ? 7 : 10),
                          color: `color-mix(in srgb, ${o.color} 85%, var(--c-ink))`,
                          boxShadow: ring,
                          opacity: done && !pastCol ? 0.55 : 1,
                        }}
                      >
                        <span className="line-clamp-2">{o.name}</span>
                        {o.location && <div className="mt-0.5 line-clamp-1 text-[8.5px] leading-[1.3] font-semibold opacity-60">{o.location}</div>}
                        {nowOn && <div className="pointer-events-none absolute inset-x-0 top-0 bg-(--c-surface)/60" style={{ height: ((now - o.start) / 60) * hour }} />}
                      </button>
                      </div>
                    )
                  })}
                  {i === todayIdx && nowTop > 0 && (
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
    </>
  )
}

/* 横滑翻周：方向锁定后手指跟随，松手按位移/速度吸附到相邻周 */
const SWIPE_LOCK = 8
const SWIPE_RATIO = 0.3
const SWIPE_VELOCITY = 0.5
const SWIPE_EASE = [0.25, 1, 0.5, 1] as const

function WeekView({ snap, anchor, setAnchor, onPick, onMenu, onSearch, liftKey }: { snap: Snapshot; anchor: string; setAnchor: (d: string) => void; onPick: (o: Occurrence) => void; onMenu: (o: Occurrence, r: Rect, el: HTMLElement) => void; onSearch: () => void; liftKey?: string }) {
  const sem = snap.semester
  const today = todayStr()
  const [cal, setCal] = useState(false)
  const week = Math.min(Math.max(weekOf(sem, anchor), 1), sem.totalWeeks)
  const thisWeek = Math.min(Math.max(weekOf(sem, today), 1), sem.totalWeeks)
  const [now, setNow] = useState(nowMinutes)
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 30_000)
    return () => clearInterval(t)
  }, [])
  const monday = dateOf(sem, week, 1)

  /* 首次进入且本周含今天：滚到当前时刻附近 */
  const scroller = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  const onGeometry = useCallback((todayIdx: number, nowTop: number) => {
    const sc = scroller.current
    const grid = gridRef.current
    if (scrolled.current || !sc || !grid || todayIdx < 0 || nowTop <= 0) return
    scrolled.current = true
    const gridTop = grid.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    const target = gridTop + nowTop - sc.clientHeight * 0.4
    if (target > 0) sc.scrollTop = target
  }, [])

  /* 换周时整块网格按方向平移；横滑翻过来的那次已经滑到位，不再播 */
  const seen = useRef(week)
  const swiped = useRef(false)
  const [dir, setDir] = useState(0)
  useEffect(() => {
    if (seen.current !== week) {
      setDir(week > seen.current ? 1 : -1)
      seen.current = week
    }
    swiped.current = false
  }, [week])

  const x = useMotionValue(0)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x0: number; y0: number; w: number; state: 'pending' | 'drag' | 'off'; last: number; t: number; v: number } | null>(null)

  const settle = (delta: -1 | 0 | 1, from: number, w: number) => {
    const to = -delta * w
    const dist = Math.abs(to - from)
    animate(x, to, { type: 'tween', ease: SWIPE_EASE, duration: Math.min(0.4, Math.max(0.2, dist / w * 0.4)) }).then(() => {
      if (!delta) return
      swiped.current = true
      x.jump(0)
      flushSync(() => setAnchor(addDays(monday, delta * 7)))
    })
  }

  const onDown = (e: React.PointerEvent) => {
    if (drag.current?.state === 'drag') return
    const pane = box.current
    if (!pane) return
    drag.current = { x0: e.clientX, y0: e.clientY, w: pane.clientWidth - 12, state: 'pending', last: 0, t: e.timeStamp, v: 0 }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.state === 'off') return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.state === 'pending') {
      if (Math.abs(dy) > SWIPE_LOCK && Math.abs(dy) >= Math.abs(dx)) {
        d.state = 'off'
        return
      }
      if (Math.abs(dx) <= SWIPE_LOCK) return
      d.state = 'drag'
      clearPress()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    const dt = e.timeStamp - d.t
    if (dt > 0) d.v = (dx - d.last) / dt
    d.last = dx
    d.t = e.timeStamp
    const blocked = (dx > 0 && week <= 1) || (dx < 0 && week >= sem.totalWeeks)
    x.set(blocked ? dx * 0.25 : dx)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.state !== 'drag') return
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    const dx = d.last
    let delta: -1 | 0 | 1 = 0
    if (dx < -d.w * SWIPE_RATIO || (dx < 0 && d.v < -SWIPE_VELOCITY)) delta = 1
    else if (dx > d.w * SWIPE_RATIO || (dx > 0 && d.v > SWIPE_VELOCITY)) delta = -1
    if ((delta === 1 && week >= sem.totalWeeks) || (delta === -1 && week <= 1)) delta = 0
    settle(delta, x.get(), d.w)
  }

  const panes = [week - 1, week, week + 1]

  return (
    <>
      <div ref={scroller} className="flex-1 overflow-y-auto pb-[130px] [scrollbar-width:none]">
        <StickyHead className="px-5">
          <div className="flex items-center justify-between">
          <button onClick={() => setCal(true)} className="flex items-center gap-1.5 text-[17px] font-extrabold tracking-[-.01em]">
            第 {week} 周
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink4)' }} strokeWidth="2.6" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] font-semibold text-(--c-ink3)">{week % 2 === 1 ? '单周' : '双周'}</span>
            <span className="h-3 w-px bg-(--c-line)" />
            <span className="text-[12.5px] font-semibold text-(--c-ink3)">{sem.name}</span>
            <SearchButton onClick={onSearch} />
          </div>
          </div>
        </StickyHead>

        <div className="mt-1 px-2">
          <div
            ref={box}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="overflow-hidden rounded-[22px] bg-(--c-surface) px-1.5 pt-2.5 pb-4 [touch-action:pan-y]"
          >
            {/* 相邻周在这层裁掉：每周自带 4px 内边，选中标记外扩的 4px 不被切 */}
            <motion.div
              key={week}
              initial={swiped.current ? false : { opacity: 0, transform: `translateX(${dir * 28}px)` }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              transition={{ type: 'tween', ease: SWIPE_EASE, duration: 0.22 }}
              className="-mx-1 overflow-hidden px-1"
            >
              <motion.div className="flex w-[300%] -ml-[100%] items-start" style={{ x }}>
                {panes.map((w) => (
                  <div key={w} className="w-1/3 flex-none px-1">
                    {w >= 1 && w <= sem.totalWeeks && (
                      <WeekGrid
                        snap={snap}
                        week={w}
                        anchor={anchor}
                        today={today}
                        now={now}
                        setAnchor={setAnchor}
                        onPick={onPick}
                        onMenu={onMenu}
                        liftKey={liftKey}
                        gridRef={w === week ? gridRef : undefined}
                        onGeometry={w === week ? onGeometry : undefined}
                      />
                    )}
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
      <BackPill show={!cal && week !== thisWeek} label="回到本周" bottom="calc(80px + max(24px, env(safe-area-inset-bottom)))" onClick={() => setAnchor(today)} />
      {cal && <CalendarSheet snap={snap} mode="week" anchor={anchor} onPick={setAnchor} onClose={() => setCal(false)} />}
    </>
  )
}

/* ---------------- 搜索 ---------------- */

/* 命中部分按原型高亮 */
function Hit({ text, q }: { text: string; q: string }) {
  const s = q.trim()
  const i = s ? text.toLowerCase().indexOf(s.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className="bg-(--c-accent-soft) text-(--c-accent)">{text.slice(i, i + s.length)}</span>
      {text.slice(i + s.length)}
    </>
  )
}

function SearchPalette({ state, onClose, onPickCourse }: { state: State; onClose: () => void; onPickCourse: (c: Course) => void }) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const locOf = new Map<string, string[]>()
    for (const r of state.rules) {
      const arr = locOf.get(r.courseId) ?? []
      if (r.location) arr.push(r.location)
      locOf.set(r.courseId, arr)
    }
    const live = state.courses.filter((c) => !c.removedByImport)
    const byName = live.filter((c) => c.name.toLowerCase().includes(s))
    const byTeacher = live.filter((c) => !byName.includes(c) && c.teacher?.toLowerCase().includes(s))
    const byRoom = live.filter((c) => !byName.includes(c) && !byTeacher.includes(c) && (locOf.get(c.id) ?? []).some((l) => l.toLowerCase().includes(s)))
    const mk = (label: string, list: Course[]): [string, Course[]] => [label, list.slice(0, 8)]
    return ([mk('课程', byName), mk('老师', byTeacher), mk('教室', byRoom)] as [string, Course[]][]).filter(([, l]) => l.length > 0)
  }, [q, state])

  return (
    <div className="flex-1 overflow-y-auto [scrollbar-width:none]">
      <div className="px-4 pt-[max(52px,calc(env(safe-area-inset-top)+22px))] pb-10">
        <div className="flex items-center rounded-full bg-(--c-surface) px-4 py-2.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink4)' }} strokeWidth="2.2" strokeLinecap="round" className="mr-2.5 flex-none"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="课程、老师、教室"
            className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-(--c-ink) outline-none placeholder:text-(--c-ink5)"
          />
          <button onClick={onClose} className="ml-auto flex-none pl-2 text-[12.5px] font-medium text-(--c-ink3)">取消</button>
        </div>

        <div className="mt-3 space-y-3.5">
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="px-1.5 text-[11.5px] font-medium text-(--c-ink4)">{g}</div>
              <div className="mt-1.5 overflow-hidden rounded-[14px] bg-(--c-surface) p-1">
                {list.map((c) => {
                  const locs = [...new Set(state.rules.filter((r) => r.courseId === c.id).map((r) => r.location).filter(Boolean))]
                  const slots = state.rules.filter((r) => r.courseId === c.id)
                  return (
                    <button key={c.id} onClick={() => onPickCourse(c)} className="flex w-full items-center rounded-[10px] px-2.5 py-2.5 text-left transition-colors active:bg-(--c-surface2)">
                      <i className="mr-3 h-[26px] w-[3px] flex-none rounded-full" style={{ background: c.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold"><Hit text={c.name} q={q} /></div>
                        <div className="mt-[2px] truncate text-[11.5px] font-medium text-(--c-ink4)">
                          {slots.length > 0 ? `${WD[slots[0].weekday]} ${slots[0].startPeriod}–${slots[0].endPeriod} 节` : '—'}{locs[0] ? `，${locs[0]}` : ''}
                        </div>
                      </div>
                      {c.teacher && <span className="ml-2 flex-none text-[11.5px] font-medium text-(--c-ink5)">{c.teacher}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {q.trim() && groups.length === 0 && (
            <div className="rounded-[14px] bg-(--c-surface) px-4 py-5 text-center text-[13px] font-medium text-(--c-ink4)">没有匹配的课程</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- 导入 ---------------- */

const KIND_LABEL: Record<RuleInputKind, string> = { csv: 'CSV', json: 'JSON', html: 'HTML', xlsx: 'Excel', ics: 'ICS 日历', script: '脚本' }
const KIND_HINT: Record<RuleInputKind, string> = {
  csv: '课程,教师,地点,星期,节次,周次',
  json: '{"courses":[{"name":"高等数学","day":1,"startNode":1,"step":2,"weeks":"1-16"}]}',
  html: '粘贴教务课表页面的 HTML',
  xlsx: '选择教务导出的 .xlsx 文件',
  ics: 'BEGIN:VCALENDAR …',
  script: '粘贴要解析的文本',
}

type ImportStage = 'input' | 'preview'

/* 规则列表（内页）：选中一条直接进导入流程 */
function ImportPage({ onBack, onManual, onEditRule, onRun, onAi }: { onBack: () => void; onManual: () => void; onEditRule: (r: RuleManifest | 'new') => void; onRun: (ruleId: string) => void; onAi: () => void }) {
  const state = useStore()
  const rules = [...state.savedRules].sort((a, b) => a.createdAt - b.createdAt)

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-10 [scrollbar-width:none]">
        <TopBar title="导入课表" onBack={onBack} />

        <div className="mt-6 text-[12.5px] font-semibold text-(--c-ink3)">规则</div>
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          {rules.map((r, i) => (
            <div key={r.id} className={i > 0 ? 'border-t border-(--c-surface2)' : ''}>
              <Row title={r.name} onClick={() => onRun(r.id)} />
            </div>
          ))}
        </div>

        <div className="mt-6 text-[12.5px] font-semibold text-(--c-ink3)">更多</div>
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Row title="让 AI 转换课表" desc="复制 Prompt，AI 输出后粘贴即可" onClick={onAi} />
          <div className="border-t border-(--c-surface2)" />
          <Row title="自定义规则" onClick={() => onEditRule('new')} />
          <div className="border-t border-(--c-surface2)" />
          <Row title="手动添加课程" onClick={onManual} />
        </div>
      </div>
    </Page>
  )
}

/* Prompt 高亮：引号内字符串、列表符号、标题分别着色 */
function promptTokens(line: string): [string, 'k' | 'p' | 's'][] {
  const out: [string, 'k' | 'p' | 's'][] = []
  const lead = /^(\s*(?:[-#]+\s|\d+\.\s))/.exec(line)
  if (lead) {
    out.push([lead[1], 'p'])
    line = line.slice(lead[1].length)
  }
  const re = /"[^"]*"/g
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push([line.slice(last, m.index), 's'])
    out.push([m[0], 'k'])
    last = m.index + m[0].length
  }
  if (last < line.length) out.push([line.slice(last), 's'])
  return out
}

/* AI 转换课表：复制 Prompt → AI 输出 JSON → 粘贴 → 走 JSON 规则解析 */
function AiImportPage({ onBack, onNext }: { onBack: () => void; onNext: (text: string) => void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_IMPORT_PROMPT)
      setCopied(true)
      nativeToast('已复制')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      nativeToast('复制失败')
    }
  }
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) {
        setText(t)
        return
      }
    } catch {
      /* 无读取权限时交给输入框 */
    }
    ta.current?.focus()
  }
  const lines = AI_IMPORT_PROMPT.trimEnd().split('\n')
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-6 [scrollbar-width:none]">
        <TopBar title="让 AI 转换课表" sub="复制这段 Prompt 连同课表交给任意 AI，输出后粘贴即可" onBack={onBack} />

        <div className="relative mt-6 rounded-[16px] bg-(--c-surface) px-4 py-4">
          <button onClick={copy} className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full transition-opacity active:opacity-60">
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-accent)' }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink2)' }} strokeWidth="1.9"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" /></svg>
            )}
          </button>
          <div className="relative h-[168px] overflow-hidden">
            {lines.map((line, i) => (
              <div key={i} className="pr-8 font-mono text-[11.5px] leading-[1.95]">
                {line === '' ? '\u00a0' : promptTokens(line).map(([t, c], j) => (
                  <span
                    key={j}
                    className="whitespace-pre-wrap"
                    style={{ color: c === 'k' ? 'var(--c-accent)' : c === 'p' ? 'var(--c-ink5)' : 'var(--c-ink2)', fontWeight: c === 'k' ? 700 : 500 }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ))}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
              style={{ background: 'linear-gradient(to bottom, transparent, var(--c-surface))' }}
            />
          </div>
        </div>

        <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-(--c-ink4)">AI 输出的课表</span>
            <TextAction onClick={paste}>粘贴</TextAction>
          </div>
          <textarea
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="在这里粘贴 AI 输出的 JSON"
            className="mt-2 h-40 w-full resize-none bg-transparent font-mono text-[12.5px] leading-[1.5] outline-none placeholder:text-(--c-ink5)"
          />
        </div>
      </div>

      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton disabled={!text.trim()} onClick={() => onNext(text)}>解析并预览</PrimaryButton>
      </div>
    </Page>
  )
}

/* 解析出来的课程卡片：与原型的课程行同一套视觉 */
function ParsedRow({ nc, sem }: { nc: NormalizedCourse; sem: Semester }) {
  const r = nc.rules[0]
  const weeks = r ? maskToWeeks(r.weeksMask) : []
  const span = weeks.length === 0
    ? ''
    : weeks.length === weeks[weeks.length - 1] - weeks[0] + 1
      ? `第 ${weeks[0]}–${weeks[weeks.length - 1]} 周`
      : weeks.every((w) => w % 2 === weeks[0] % 2)
        ? `第 ${weeks[0]}–${weeks[weeks.length - 1]} 周${weeks[0] % 2 === 1 ? '单' : '双'}`
        : `${weeks.length} 周`
  const slot = r ? `${WD[r.weekday]} ${r.startPeriod}–${r.endPeriod} 节` : '—'
  const time = r ? `${fmtMinutes(sem.timeGrid[r.startPeriod - 1]?.start ?? 0)}–${fmtMinutes(sem.timeGrid[r.endPeriod - 1]?.end ?? 0)}` : ''
  return (
    <div className="flex items-center px-4 py-3">
      <i className="mr-3 h-[26px] w-[3px] flex-none rounded-full" style={{ background: nc.course.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">{nc.course.name}</div>
        <div className="mt-0.5 truncate text-[12px] font-medium text-(--c-ink4)">
          {[slot, time, span, r?.location, nc.course.teacher].filter(Boolean).join('，')}
        </div>
      </div>
      {nc.rules.length > 1 && <span className="ml-2 flex-none text-[11.5px] font-semibold text-(--c-ink5)">{nc.rules.length} 段</span>}
    </div>
  )
}

/* 导入流程（内页）：输入 → 解析结果 → 回到课表 */
function ImportRunPage({ rule, initialText, autoRun, onBack, onDone }: { rule: RuleManifest; initialText?: string; autoRun?: boolean; onBack: () => void; onDone: () => void }) {
  const [stage, setStage] = useState<ImportStage>('input')
  const [text, setText] = useState(initialText ?? '')
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [fileName, setFileName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'' | 'fetch' | 'parse'>('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ReturnType<Store['previewImport']> | null>(null)
  const [pending, setPending] = useState<ReturnType<typeof normalize> | null>(null)
  const sem = store.state.semester ?? defaultSemester(mondayOf(todayStr()))

  const parse = async () => {
    setBusy('parse')
    setError('')
    try {
      if (!store.state.semester) store.setSemester(sem)
      const out: RuleOutput = await runRule(rule, { text, bytes: fileBytes ?? undefined }, sem)
      let target = store.state.semester ?? sem
      const need = Math.min(20, Math.max(0, ...out.courses.map((c) => c.endPeriod)))
      if (out.semester) {
        // 课程表自己导出的文件：学期、节次表照单全收
        target = { ...target, ...out.semester, timeGrid: out.timeGrid ?? target.timeGrid }
        store.setSemester(target)
      } else if (out.timeGrid && out.timeGrid.length > target.timeGrid.length) {
        target = { ...target, timeGrid: out.timeGrid }
        store.setSemester(target)
      }
      if (need > target.timeGrid.length) {
        const grid = [...target.timeGrid]
        while (grid.length < need) {
          const last = grid[grid.length - 1]
          const dur = last ? last.end - last.start : 45
          const start = last ? last.end + 10 : 8 * 60
          grid.push({ index: grid.length + 1, start, end: start + dur })
        }
        target = { ...target, timeGrid: grid }
        store.setSemester(target)
      }
      const norm = normalize(out, target)
      setPending(norm)
      setPreview(store.previewImport(norm.courses))
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败')
    } finally {
      setBusy('')
    }
  }

  const confirm = () => {
    if (!pending) return
    const t0 = performance.now()
    const failed = pending.diagnostics.filter((d) => d.level === 'error').length
    const hadCourses = store.state.courses.length > 0
    store.applyImport(pending.courses, {
      id: uid(), semesterId: store.state.semester!.id,
      ruleId: rule.id, ruleName: rule.name, ruleVersion: rule.version,
      at: Date.now(), durationMs: Math.max(1, Math.round(performance.now() - t0)),
      failed, diagnostics: pending.diagnostics,
    })
    onDone()
  }

  const grab = async () => {
    setBusy('fetch')
    setError('')
    try {
      const res = await fetchUrl(url.trim())
      setText(res.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : '抓取失败，可以改用复制粘贴')
    } finally {
      setBusy('')
    }
  }

  const errors = pending?.diagnostics.filter((d) => d.level === 'error') ?? []

  /* 文件是用课程表直接打开的：不经过粘贴页，直接给预览 */
  const auto = useRef(autoRun && !!initialText)
  useEffect(() => {
    if (!auto.current) return
    auto.current = false
    void parse()
  }, [])

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-6 [scrollbar-width:none]">
        <TopBar
          title={stage === 'input' ? rule.name : `${pending?.courses.length ?? 0} 门课`}
          sub={stage === 'input' ? KIND_LABEL[rule.input] : undefined}
          onBack={stage === 'preview' ? () => setStage('input') : onBack}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stage} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
            {stage === 'input' && (
              <div className="mt-6">
                {rule.input === 'xlsx' ? (
                  <label className="flex w-full cursor-pointer items-center justify-center rounded-[16px] bg-(--c-surface) py-10 text-[13.5px] font-semibold text-(--c-ink2)">
                    {fileName || '选择 .xlsx 文件'}
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        setFileBytes(new Uint8Array(await f.arrayBuffer()))
                        setFileName(f.name)
                      }}
                    />
                  </label>
                ) : (
                  <>
                    <div className="flex items-center gap-3 rounded-[16px] bg-(--c-surface) px-4 py-2.5">
                      <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// 链接" className="min-w-0 flex-1 text-[13px]" />
                      <TextAction disabled={!url.trim() || busy !== ''} busy={busy === 'fetch'} onClick={grab}>抓取</TextAction>
                    </div>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={KIND_HINT[rule.input]}
                      className="mt-2.5 h-64 w-full rounded-[16px] bg-(--c-surface) p-3.5 font-mono text-[12px] leading-relaxed outline-none placeholder:text-(--c-ink5) focus:ring-1 focus:ring-(--c-accent-line)"
                    />
                  </>
                )}
                {error && <div className="mt-2.5 px-1 text-[12.5px] font-medium text-(--c-danger)">{error}</div>}
              </div>
            )}

            {stage === 'preview' && pending && preview && (
              <div className="mt-6">
                <div className="flex items-baseline gap-4 px-1 text-[12.5px] font-semibold tabular-nums">
                  {preview.added.length > 0 && <span className="text-(--c-accent)">新增 {preview.added.length}</span>}
                  {preview.unchanged > 0 && <span className="text-(--c-ink3)">不变 {preview.unchanged}</span>}
                  {preview.protectedKept.length > 0 && <span className="text-(--c-ink3)">保留改动 {preview.protectedKept.length}</span>}
                  {preview.removed.length > 0 && <span className="text-(--c-danger)">消失 {preview.removed.length}</span>}
                </div>

                <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
                  {pending.courses.map((nc) => (
                    <ParsedRow key={nc.course.identityKey} nc={nc} sem={sem} />
                  ))}
                  {pending.courses.length === 0 && (
                    <div className="px-4 py-8 text-center text-[13px] font-medium text-(--c-ink4)">没有解析出课程</div>
                  )}
                </div>

                {preview.removed.length > 0 && (
                  <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5 text-[12.5px] font-medium text-(--c-ink3)">
                    <span className="font-bold text-(--c-danger)">进回收站</span>　{preview.removed.map((c) => c.name).join('、')}
                  </div>
                )}

                {errors.length > 0 && (
                  <>
                    <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">{errors.length} 条无法解析</div>
                    <div className="mt-2 space-y-2">
                      {errors.map((d, i) => (
                        <div key={i} className="rounded-[12px] bg-(--c-surface) px-3.5 py-2.5">
                          <div className="text-[12.5px] font-bold text-(--c-danger)">{d.message}</div>
                          {d.at?.snippet && <div className="mt-1 truncate font-mono text-[11px] text-(--c-ink4)">{d.at.snippet}</div>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        {stage === 'input' ? (
          <PrimaryButton disabled={busy === 'fetch' || (rule.input === 'xlsx' ? !fileBytes : !text.trim())} busy={busy === 'parse'} onClick={parse}>解析</PrimaryButton>
        ) : (
          <PrimaryButton disabled={(pending?.courses.length ?? 0) === 0} onClick={confirm}>导入</PrimaryButton>
        )}
      </div>
    </Page>
  )
}

/* ---------------- 规则编辑 ---------------- */

const SCRIPT_TEMPLATE = `// 输入整段文本，返回课程数组
function parse(input) {
  return { courses: input.split('\\n').filter(Boolean).map(line => {
    const [name, teacher, location, weekday, sp, ep, weeks] = line.split(',')
    return { name, teacher, location, weekday: Number(weekday), startPeriod: Number(sp), endPeriod: Number(ep), weeks }
  }), diagnostics: [] }
}`

function bumpVersion(v: string): string {
  const [a, b] = v.split('.').map((n) => parseInt(n, 10) || 0)
  return `${a}.${b + 1}`
}

function RuleEditorPage({ rule, onBack }: { rule: RuleManifest | null; onBack: () => void }) {
  const KINDS: RuleInputKind[] = ['csv', 'json', 'html', 'xlsx', 'ics', 'script']
  const [name, setName] = useState(rule?.name ?? '')
  const [input, setInput] = useState<RuleInputKind>(rule?.input ?? 'csv')
  const [script, setScript] = useState(rule?.script ?? SCRIPT_TEMPLATE)
  const builtin = !!rule?.id.startsWith('builtin-')

  const save = () => {
    const next: RuleManifest = {
      id: rule?.id ?? uid(),
      name: name.trim() || KIND_LABEL[input],
      version: rule ? bumpVersion(rule.version) : '1.0',
      input,
      csv: input === 'csv' || input === 'xlsx' ? (rule?.csv ?? DEFAULT_CSV_MAPPING) : undefined,
      html: input === 'html' ? (rule?.html ?? { mode: 'grid' }) : undefined,
      script: input === 'script' ? script : undefined,
      samples: rule?.samples,
      createdAt: rule?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    store.saveRule(next)
    onBack()
  }

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-10 [scrollbar-width:none]">
        <TopBar title={rule ? '编辑规则' : '添加规则'} onBack={onBack} />

        <div className="mt-6 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Field k="规则名"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND_LABEL[input]} /></Field>
        </div>

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">输入类型</div>
        <div className="mt-2.5">
          <Chips items={KINDS.map((k) => KIND_LABEL[k])} active={KINDS.indexOf(input)} onPick={(i) => setInput(KINDS[i])} />
        </div>

        {input === 'script' && (
          <>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              spellCheck={false}
              className="mt-4 h-56 w-full rounded-[16px] bg-(--c-surface) p-3.5 font-mono text-[11.5px] leading-relaxed outline-none focus:ring-1 focus:ring-(--c-accent-line)"
            />
          </>
        )}

        {rule && !builtin && (
          <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
            <Row title="删除规则" danger onClick={() => { store.removeRule(rule.id); onBack() }} right={<span />} />
          </div>
        )}
      </div>
      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton onClick={save}>保存</PrimaryButton>
      </div>
    </Page>
  )
}

/* ---------------- 我的 ---------------- */

type MePage = 'semester' | 'history' | 'trash' | 'courses' | 'import' | 'share' | 'changes' | 'notif' | 'widget' | 'theme' | 'profile' | 'stats' | 'erase'

const WIDGET_LABEL: Record<WidgetStyle, string> = {
  today: '今日课程',
  next: '下一节',
  twoDays: '今天与明天',
  week: '本周课表',
}

function MeView({ onPage }: { onPage: (p: MePage) => void }) {
  const state = useStore()
  const theme = useTheme()
  const sem = state.semester
  const trashCount = state.courses.filter((c) => c.removedByImport).length
  const live = state.courses.filter((c) => !c.removedByImport)
  const week = sem ? weekOf(sem, todayStr()) : 0
  const homework = state.tasks.filter((t) => t.kind === 'homework')

  const groups: [string, [string, string, MePage][]][] = [
    ['课表', [
      ['学期', sem ? `${sem.name}，第 ${Math.max(0, Math.min(sem.totalWeeks, week))} / ${sem.totalWeeks} 周` : '未设置', 'semester'],
      ['课程', `${live.length} 门`, 'courses'],
      ['导入课表', '', 'import'],
      ['分享课表', '', 'share'],
    ]],
    ['提醒', [
      ['上课提醒', `课前 ${state.prefs.classLead} 分钟`, 'notif'],
      ['作业提醒', taskLeadsText(state.prefs.taskLeads), 'notif'],
    ]],
    ['外观', [
      ['主题', THEME_LABEL[theme], 'theme'],
    ]],
    ['记录', [
      ['变更记录', `${state.changes.length + state.overrides.length} 条`, 'changes'],
      ['导入历史', `${state.batches.length} 次`, 'history'],
      ['回收站', trashCount > 0 ? `${trashCount} 门` : '空', 'trash'],
    ]],
    ['数据', [
      ['清除数据', '', 'erase'],
    ]],
  ]
  const avatar = usePhotoSrc(state.prefs.avatar, '/avatar.jpg')
  const wall = usePhotoSrc(state.prefs.wall, '/wall.jpg')

  const meHero = useRef<HTMLDivElement>(null)
  const meHead = useRef<HTMLDivElement>(null)
  /* 头图在标题下面时不起白色羽化（原型里标题是直接写在图上的白字），等头图滑过标题区下沿之后才接上常规羽化 */
  const meVeil = useVeilOpacity(meHero, () => (meHero.current?.offsetHeight ?? 258) - (meHead.current?.offsetHeight ?? 0))
  /* 标题字色：头图顶部的暗色带（92px）滑走后就换成深色 */
  const meInkRaw = useVeilOpacity(meHero, () => 60)
  const meInk = useTransform(meInkRaw, (v) => Math.max(0, Math.min(1, v)))
  const meWhite = useTransform(meInk, (v) => 1 - v)
  return (
    <>
      <div ref={meHead} className="pointer-events-none absolute inset-x-0 top-0 z-[30] isolate px-5 pt-[max(52px,calc(env(safe-area-inset-top)+22px))] pb-3">
        <TopVeil progress={meVeil} />
        <span className="relative inline-block text-[15px] font-bold tracking-[-.01em]">
          <motion.span style={{ opacity: meWhite }} className="text-white drop-shadow-[0_1px_6px_rgba(0,0,0,.35)]">我的</motion.span>
          <motion.span style={{ opacity: meInk }} className="absolute inset-0 text-(--c-ink)">我的</motion.span>
        </span>
      </div>
      <div className="relative flex-1 overflow-y-auto pb-[130px] [scrollbar-width:none]">
        <div ref={meHero} className="relative h-[258px] overflow-hidden bg-[#5d6d55]">
          <button onClick={() => onPage('profile')} className="absolute inset-0 transition-opacity active:opacity-85">
            <img src={wall} alt="" className="h-full w-full object-cover object-[50%_32%]" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[150px] bg-gradient-to-t from-(--c-bg) via-(--c-bg)/70 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[92px] bg-gradient-to-b from-black/25 to-transparent" />
          <button onClick={() => onPage('profile')} className="absolute inset-x-5 bottom-3 flex items-end text-left transition-opacity active:opacity-70">
            <img src={avatar} alt="" className="h-[62px] w-[62px] flex-none rounded-full border-[1.5px] border-(--c-bg) bg-(--c-accent) object-cover" />
            <div className="mb-1 ml-3.5 flex-1">
              <div className="text-[19px] font-extrabold tracking-[-.02em] text-(--c-ink)">{state.prefs.name || sem?.name || '我的课表'}</div>
              <div className="mt-[3px] flex items-center gap-2.5 text-[12px] font-semibold text-(--c-ink3)">
                <span>{sem ? `第 ${Math.max(0, Math.min(sem.totalWeeks, week))} / ${sem.totalWeeks} 周` : '未设置学期'}</span>
                {sem && <span className="tabular-nums text-(--c-ink5)">{md(sem.startDate)} 起</span>}
              </div>
            </div>
          </button>
        </div>

        <div className="px-5">
          <button onClick={() => onPage('stats')} className="flex w-full rounded-[18px] bg-(--c-surface) px-4 py-3.5 transition-opacity active:opacity-60">
            {[[String(live.length), '门课'], [String(state.overrides.length), '次调整'], [String(homework.length), '项作业']].map(([n, l], i) => (
              <div key={l} className={`flex-1 ${i ? 'border-l border-(--c-surface2)' : ''}`}>
                <div className="text-center text-[17px] font-extrabold tabular-nums text-(--c-ink)">{n}</div>
                <div className="mt-0.5 text-center text-[11px] font-semibold text-(--c-ink4)">{l}</div>
              </div>
            ))}
          </button>

          {groups.map(([g, rows]) => (
            <div key={g} className="mt-5">
              <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">{g}</div>
              <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
                {rows.map(([k, v, page], i) => (
                  <button
                    key={k}
                    onClick={() => onPage(page)}
                    className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
                  >
                    <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{k}</span>
                    <span className="text-[12.5px] font-medium text-(--c-ink4)">{v}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.2" className="ml-2"><path d="m9 5 7 7-7 7" /></svg>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* 头像 / 背景：自选照片先用直接路径再换成可显示的，没选则用内置图 */
function usePhotoSrc(path: string, fallback: string): string {
  const [src, setSrc] = useState(() => (path ? photoSrc(path) : ''))
  useEffect(() => {
    if (!path) {
      setSrc('')
      return
    }
    let alive = true
    setSrc(photoSrc(path))
    void loadPhotoSrc(path).then((s) => alive && setSrc(s))
    return () => {
      alive = false
    }
  }, [path])
  return src || fallback
}

const periodsOf = (r: SessionRule) => r.endPeriod - r.startPeriod + 1
const fmtNum = (n: number) => String(Math.round(n * 10) / 10)

type PhotoTarget = 'avatar' | 'wall'

function CameraBadge({ className }: { className: string }) {
  return (
    <span className={`grid place-items-center rounded-full ${className}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{ICON.camera}</svg>
    </span>
  )
}

/* 个人资料：顶部就是「我」页头图的缩影，点背景换背景、点头像换头像；已自定义时弹出「从相册选择 / 恢复默认」 */
function ProfilePage({ onBack, onPick }: { onBack: () => void; onPick: (t: PhotoTarget) => void }) {
  const state = useStore()
  const avatar = usePhotoSrc(state.prefs.avatar, '/avatar.jpg')
  const wall = usePhotoSrc(state.prefs.wall, '/wall.jpg')
  const [menu, setMenu] = useState<PhotoTarget | null>(null)
  const tap = (t: PhotoTarget) => (state.prefs[t] ? setMenu(t) : onPick(t))
  const reset = (t: PhotoTarget) => {
    void camera.remove([state.prefs[t]])
    store.setPrefs(t === 'avatar' ? { avatar: '' } : { wall: '' })
  }
  return (
    <SubPage title="个人资料" onBack={onBack}>
      <div className="relative h-[172px] overflow-hidden rounded-[18px] bg-[#5d6d55]">
        <button onClick={() => tap('wall')} className="absolute inset-0 transition-opacity active:opacity-80">
          <img src={wall} alt="" className="h-full w-full object-cover object-[50%_32%]" />
          <div className="absolute inset-x-0 bottom-0 h-[96px] bg-gradient-to-t from-black/50 to-transparent" />
          <CameraBadge className="absolute top-3 right-3 h-[28px] w-[28px] bg-black/35 text-white backdrop-blur-md" />
        </button>
        <button onClick={() => tap('avatar')} className="absolute bottom-4 left-4 h-[64px] w-[64px] transition-transform duration-150 active:scale-[.95]">
          <img src={avatar} alt="" className="h-full w-full rounded-full border-2 border-white/90 object-cover" />
          <CameraBadge className="absolute -right-0.5 -bottom-0.5 h-[24px] w-[24px] bg-(--c-ink) text-(--c-bg) ring-2 ring-white" />
        </button>
      </div>
      {menu && (
        <ActionSheet
          title={menu === 'avatar' ? '头像' : '背景'}
          groups={[[
            { title: '从相册选择', icon: ICON.image, onClick: () => onPick(menu) },
            { title: '恢复默认', icon: ICON.undo, onClick: () => reset(menu) },
          ]]}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
        <Field k="名称">
          <TextInput
            value={state.prefs.name}
            maxLength={20}
            placeholder={state.semester?.name ?? '我的课表'}
            onChange={(e) => store.setPrefs({ name: e.target.value })}
            onBlur={(e) => store.setPrefs({ name: e.target.value.trim() })}
          />
        </Field>
      </div>
    </SubPage>
  )
}

/* 统计：学期走到哪、每门课上到哪，请过假的课单独标出来；可直接给导师或老师看 */
function StatsPage({ onBack, onCourse, onChanges, onTodo }: { onBack: () => void; onCourse: (c: Course) => void; onChanges: () => void; onTodo: () => void }) {
  const state = useStore()
  const sem = state.semester
  const live = state.courses.filter((c) => !c.removedByImport)
  const today = todayStr()
  const ruleCourse = new Map(state.rules.map((r) => [r.id, r.courseId]))

  const rows = live.map((c) => {
    const rs = state.rules.filter((r) => r.courseId === c.id)
    const weeks = new Set<number>()
    let total = 0
    let done = 0
    for (const r of rs) {
      for (const w of maskToWeeks(r.weeksMask)) {
        weeks.add(w)
        total += periodsOf(r)
        if (sem && dateOf(sem, w, r.weekday) < today) done += periodsOf(r)
      }
    }
    const leave = state.overrides.filter((o) => o.kind === 'leave' && ruleCourse.get(o.ruleId) === c.id).length
    return { c, total, done, weekly: weeks.size ? Math.round(total / weeks.size) : 0, leave }
  })
  const totalPeriods = rows.reduce((a, r) => a + r.total, 0)
  const weekly = sem && sem.totalWeeks > 0 ? Math.round(totalPeriods / sem.totalWeeks) : 0
  const week = sem ? Math.min(Math.max(weekOf(sem, today), 0), sem.totalWeeks) : 0

  const byCategory = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.c.category?.trim() || ''
    byCategory.set(k, [...(byCategory.get(k) ?? []), r])
  }
  const cats = [...byCategory.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh-CN')))
  const donePeriods = rows.reduce((a, r) => a + r.done, 0)
  const facts = [
    live.length > 0 ? `${live.length} 门课` : '',
    weekly > 0 ? `每周 ${weekly} 节` : '',
    donePeriods > 0 ? `已上 ${donePeriods} 节` : '',
  ].filter(Boolean)

  const liveIds = new Set(live.map((c) => c.id))
  const ovs = state.overrides.filter((o) => liveIds.has(ruleCourse.get(o.ruleId) ?? ''))
  const nOv = (k: OverrideKind) => ovs.filter((o) => o.kind === k).length
  const homework = state.tasks.filter((t) => t.kind === 'homework')
  const exams = state.tasks.filter((t) => t.kind === 'exam')
  const firstDays = new Set(state.rules.filter((r) => liveIds.has(r.courseId) && r.startPeriod === 1).map((r) => r.weekday)).size
  type More = [string, string, (() => void) | null]
  const more = (
    [
      ['第一节有课', firstDays > 0 ? `每周 ${firstDays} 天` : '', null],
      ['作业', homework.length > 0 ? `${homework.filter((t) => t.done).length} / ${homework.length} 已完成` : '', onTodo],
      ['考试', exams.length > 0 ? `${exams.length} 场` : '', onTodo],
      ['请假', nOv('leave') > 0 ? `${nOv('leave')} 次` : '', onChanges],
      ['停课', nOv('cancelled') > 0 ? `${nOv('cancelled')} 次` : '', onChanges],
      ['调课', nOv('moved') > 0 ? `${nOv('moved')} 次` : '', onChanges],
    ] as More[]
  ).filter((m) => m[1])

  return (
    <SubPage title="统计" onBack={onBack}>
      {sem && (
        <div className="rounded-[18px] bg-(--c-surface) px-4 pt-4 pb-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[22px] font-extrabold tracking-[-.02em] text-(--c-ink)">第 {week} 周</span>
            <span className="text-[12.5px] font-medium tabular-nums text-(--c-ink4)">共 {sem.totalWeeks} 周</span>
          </div>
          <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-(--c-surface2)">
            <div className="h-full rounded-full bg-(--c-ink)" style={{ width: `${sem.totalWeeks > 0 ? Math.min(100, (week / sem.totalWeeks) * 100) : 0}%` }} />
          </div>
          {facts.length > 0 && (
            <div className="mt-3.5 flex gap-3 text-[12.5px] font-medium tabular-nums text-(--c-ink3)">
              {facts.map((f) => <span key={f}>{f}</span>)}
            </div>
          )}
        </div>
      )}

      {cats.map((cat) => (
        <div key={cat || '_'} className="mt-5">
          <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">{cat || (cats.length > 1 ? '其他' : '课程')}</div>
          <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
            {(byCategory.get(cat) ?? []).map(({ c, total, done, weekly: w, leave }, i) => {
              const meta = [c.teacher ?? '', w > 0 ? `每周 ${w} 节` : ''].filter(Boolean)
              return (
                <button key={c.id} onClick={() => onCourse(c)} className={`block w-full py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}>
                  <div className="flex items-baseline">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-(--c-ink)">{c.name}</span>
                    {total > 0 && <span className="ml-3 flex-none text-[12.5px] font-semibold tabular-nums text-(--c-ink3)">{done} / {total} 节</span>}
                  </div>
                  {total > 0 && (
                    <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-(--c-surface2)">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (done / total) * 100)}%`, background: c.color }} />
                    </div>
                  )}
                  {(meta.length > 0 || leave > 0) && (
                    <div className="mt-1.5 flex items-baseline text-[12px] font-medium tabular-nums text-(--c-ink4)">
                      <span className="flex min-w-0 flex-1 gap-2.5 truncate">{meta.map((m) => <span key={m}>{m}</span>)}</span>
                      {leave > 0 && <span className="ml-3 flex-none text-(--c-danger)">请假 {leave} 次</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {more.length > 0 && (
        <div className="mt-5">
          <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">本学期</div>
          <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
            {more.map(([k, v, go], i) => (
              <button key={k} onClick={go ?? undefined} disabled={!go} className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 disabled:active:opacity-100 ${i ? 'border-t border-(--c-surface2)' : ''}`}>
                <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{k}</span>
                <span className="text-[12.5px] font-medium tabular-nums text-(--c-ink4)">{v}</span>
                {go && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.2" className="ml-2"><path d="m9 5 7 7-7 7" /></svg>}
              </button>
            ))}
          </div>
        </div>
      )}
    </SubPage>
  )
}

/* 清除数据：本机课表、作业和系统日历里应用建的日历一并删掉，回到初始状态 */
function ErasePage({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    const s = store.state
    const paths = [...s.tasks.flatMap((t) => t.photos?.map((p) => p.path) ?? []), s.prefs.avatar, s.prefs.wall].filter(Boolean)
    await clearCalendar()
    await camera.remove(paths)
    store.reset()
    await syncWidgets()
    onDone()
  }
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 [scrollbar-width:none]">
        <TopBar title="清除数据" sub="卸载应用不会移除系统日历中的内容。" onBack={onBack} />
        <div className="mt-6 rounded-[18px] bg-(--c-surface) px-4">
          {['课表、课程和调整', '作业和照片', '系统日历中由本应用创建的日历'].map((t, i) => (
            <div key={t} className={`py-3.5 text-[14px] font-semibold text-(--c-ink) ${i ? 'border-t border-(--c-surface2)' : ''}`}>{t}</div>
          ))}
        </div>
      </div>
      <div className="flex-none px-5 pt-3 pb-[max(28px,env(safe-area-inset-bottom))]">
        <PrimaryButton tone="danger" busy={busy} onClick={() => void run()}>清除全部数据</PrimaryButton>
      </div>
    </Page>
  )
}

const THEME_ORDER: ThemePref[] = ['system', 'light', 'dark', 'black']

/* 主题选择：选项列表同提醒设置页，上方三块小预览直接用各主题的色板渲染 */
function ThemePage({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const [dyn, dynOk] = useDynamic()
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none]">
        <TopBar title="主题" onBack={onBack} />
        <div className="mt-6 flex gap-3">
          {(['light', 'dark', 'black'] as const).map((r) => {
            const on = theme === r || (theme === 'system' && resolve() === r)
            return (
              <button
                key={r}
                onClick={() => setTheme(r)}
                data-theme={r}
                className={`flex-1 overflow-hidden rounded-[16px] bg-(--c-bg) p-2.5 ring-[1.5px] transition-transform duration-150 active:scale-[.97] ${on ? 'ring-(--c-accent)' : 'ring-(--c-line)'}`}
              >
                <div className="rounded-[10px] bg-(--c-surface) p-2">
                  <div className="h-[6px] w-2/3 rounded-full bg-(--c-ink)" />
                  <div className="mt-1.5 h-[5px] w-1/2 rounded-full bg-(--c-ink4)" />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <div className="h-[14px] flex-1 rounded-[5px] bg-(--c-accent)" />
                  <div className="h-[14px] flex-1 rounded-[5px] bg-(--c-surface)" />
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-5 rounded-[18px] bg-(--c-surface) px-4">
          {THEME_ORDER.map((t, i) => {
            const on = theme === t
            return (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
              >
                <span className={`flex-1 text-[14px] font-semibold ${on ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{THEME_LABEL[t]}</span>
                {on && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-accent)' }} strokeWidth="2.6"><path d="m5 13 4.5 4.5L19 7" /></svg>
                )}
              </button>
            )
          })}
        </div>
        {dynOk && (
          <>
            <div className="mt-6 px-1 text-[12px] font-bold text-(--c-ink4)">主题色</div>
            <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
              {([[false, '默认'], [true, '跟随系统配色']] as const).map(([v, label], i) => {
                const on = dyn === v
                return (
                  <button
                    key={label}
                    onClick={() => setDynamic(v)}
                    className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
                  >
                    <span className={`flex-1 text-[14px] font-semibold ${on ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{label}</span>
                    {on && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-accent)' }} strokeWidth="2.6"><path d="m5 13 4.5 4.5L19 7" /></svg>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

function SubPage({ title, sub, onBack, children }: { title: string; sub?: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-10 [scrollbar-width:none]">
        <TopBar title={title} sub={sub} onBack={onBack} />
        <div className="mt-6">{children}</div>
      </div>
    </Page>
  )
}

function SemesterSettings({ sem, onBack }: { sem: Semester; onBack: () => void }) {
  const [name, setName] = useState(sem.name)
  const [date, setDate] = useState(sem.startDate)
  const [weeks, setWeeks] = useState(sem.totalWeeks)
  const [grid, setGrid] = useState(sem.timeGrid)
  const start = mondayOf(date)

  const setSlot = (index: number, which: 'start' | 'end', hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return
    setGrid((g) => g.map((t) => (t.index === index ? { ...t, [which]: h * 60 + m } : t)))
  }

  return (
    <SubPage title="学期" sub={`第 ${Math.max(1, currentWeek(start))} 周，共 ${weeks} 周`} onBack={onBack}>
      <div className="divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
        <Field k="名称"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field k="开学" sub={`第 1 周 ${md(start)} 周一`}><DateInput value={date} onChange={setDate} /></Field>
        <Field k="总周数"><TextInput type="number" min={1} max={64} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /></Field>
      </div>

      <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">节次时间</div>
      <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
        {grid.map((t) => (
          <div key={t.index} className="flex items-center px-4 py-2.5">
            <span className="w-[62px] flex-none text-[12.5px] font-medium text-(--c-ink4)">第 {t.index} 节</span>
            <TimeInput value={fmtMinutes(t.start)} onChange={(v) => setSlot(t.index, 'start', v)} className="w-auto text-[13.5px]" />
            <span className="px-2 text-[13px] text-(--c-ink5)">–</span>
            <TimeInput value={fmtMinutes(t.end)} onChange={(v) => setSlot(t.index, 'end', v)} className="w-auto text-[13.5px]" />
          </div>
        ))}
      </div>

      <div className="mt-8">
        <PrimaryButton
          onClick={() => {
            store.setSemester({
              ...sem,
              name: name.trim() || sem.name,
              startDate: start,
              totalWeeks: Math.min(64, Math.max(1, weeks)),
              timeGrid: grid,
            })
            onBack()
          }}
        >保存</PrimaryButton>
      </div>
    </SubPage>
  )
}

function HistoryPage({ onBack }: { onBack: () => void }) {
  const state = useStore()
  const batches = [...state.batches].reverse()
  return (
    <SubPage title="导入历史" sub={`共 ${batches.length} 次`} onBack={onBack}>
      {batches.length === 0 && <EmptyBlock kind="none" title="无导入记录" />}
      <div className="space-y-2.5">
        {batches.map((b) => (
          <div key={b.id} className="rounded-[16px] bg-(--c-surface) px-4 py-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[13.5px] font-bold">{b.ruleName} <span className="font-medium text-(--c-ink5)">v{b.ruleVersion}</span></span>
              <span className="text-[11.5px] font-medium tabular-nums text-(--c-ink4)">{new Date(b.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium text-(--c-ink3)">
              新增 {b.added}，更新 {b.updated}{b.removed > 0 ? `，消失 ${b.removed}` : ''}{b.failed > 0 ? `，失败 ${b.failed}` : ''}，用时 {(b.durationMs / 1000).toFixed(1)} 秒
            </div>
            {b.diagnostics.filter((d) => d.level === 'error').slice(0, 3).map((d, i) => (
              <div key={i} className="mt-1.5 text-[11.5px] font-medium text-(--c-danger)">{d.message}</div>
            ))}
          </div>
        ))}
      </div>
    </SubPage>
  )
}

function TrashPage({ onBack }: { onBack: () => void }) {
  const state = useStore()
  const removed = state.courses.filter((c) => c.removedByImport)
  return (
    <SubPage title="回收站" sub={removed.length > 0 ? `${removed.length} 门课` : undefined} onBack={onBack}>
      {removed.length === 0 && <EmptyBlock kind="free" title="无课程" />}
      <div className="space-y-2.5">
        {removed.map((c) => (
          <div key={c.id} className="flex items-center rounded-[16px] bg-(--c-surface) px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">{c.name}</div>
              <div className="mt-0.5 text-[12px] font-medium text-(--c-ink4)">{c.teacher ?? '—'}，上次导入时消失</div>
            </div>
            <div className="ml-3 flex flex-none items-center gap-4">
              <TextAction onClick={() => store.restoreCourse(c.id)}>恢复</TextAction>
              <TextAction tone="danger" onClick={() => store.purgeCourse(c.id)}>删除</TextAction>
            </div>
          </div>
        ))}
      </div>
    </SubPage>
  )
}

function CoursesPage({ onBack, onDetail, onManual }: { onBack: () => void; onDetail: (c: Course) => void; onManual: () => void }) {
  const state = useStore()
  const courses = state.courses.filter((c) => !c.removedByImport)
  return (
    <SubPage title="课程" sub={`${courses.length} 门`} onBack={onBack}>
      {courses.length === 0 ? (
        <EmptyBlock kind="none" title="无课程" actions={[['手动添加', onManual]]} />
      ) : (
        <div className="overflow-hidden rounded-[16px] bg-(--c-surface)">
          {courses.map((c, i) => {
            const slots = state.rules.filter((r) => r.courseId === c.id)
            return (
              <button key={c.id} onClick={() => onDetail(c)} className={`flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-(--c-bg) ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
                <i className="mr-3 h-[26px] w-[3px] flex-none rounded-full" style={{ background: c.color }} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[14px] font-bold ${c.hidden ? 'text-(--c-ink5) line-through' : ''}`}>{c.name}</div>
                  <div className="mt-0.5 truncate text-[12px] font-medium text-(--c-ink4)">
                    {slots.length > 0 ? slots.map((s) => `${WD[s.weekday]} ${s.startPeriod}–${s.endPeriod}`).join('，') : '—'}
                  </div>
                </div>
                {c.teacher && <span className="ml-2 flex-none text-[11.5px] font-medium text-(--c-ink5)">{c.teacher}</span>}
              </button>
            )
          })}
        </div>
      )}
    </SubPage>
  )
}

/* ---------------- 根 ---------------- */

const ONBOARD_KEY = 'tt.onboarded.v1'

type Route =
  | { k: 'course'; course: Course }
  | { k: 'courseEdit'; course: Course }
  | { k: 'session'; occ: Occurrence }
  | { k: 'conflict'; occ: Occurrence }
  | { k: 'changes'; courseId?: string }
  | { k: 'todoDetail'; task: Task }
  | { k: 'todoCamera'; courseId?: string; taskId?: string }
  | { k: 'todoPicker'; courseId?: string; taskId?: string }
  | { k: 'todoReview'; photos: CapturedPhoto[]; courseId?: string }
  | { k: 'manual' }
  | { k: 'import' }
  | { k: 'importRun'; ruleId: string; text?: string; auto?: boolean }
  | { k: 'aiImport' }
  | { k: 'rule'; rule: RuleManifest | null }
  | { k: 'semester' }
  | { k: 'history' }
  | { k: 'trash' }
  | { k: 'courses' }
  | { k: 'notif' }
  | { k: 'calendarIntro' }
  | { k: 'notifPick'; pref: PrefKey }
  | { k: 'widget' }
  | { k: 'theme' }
  | { k: 'profile' }
  | { k: 'photoPick'; target: PhotoTarget }
  | { k: 'stats' }
  | { k: 'erase' }

/* 课程详情里点某条每周安排：找到这条规则在本周（或第一周）的那次课 */
function occurrenceOfRule(snap: Snapshot, ruleId: string): Occurrence | null {
  const rule = snap.rules.find((r) => r.id === ruleId)
  if (!rule) return null
  const cur = Math.max(1, Math.min(snap.semester.totalWeeks, weekOf(snap.semester, todayStr())))
  const weeks = [cur, ...Array.from({ length: snap.semester.totalWeeks }, (_, i) => i + 1)]
  for (const w of weeks) {
    if (!maskHasWeek(rule.weeksMask, w)) continue
    const date = dateOf(snap.semester, w, rule.weekday)
    const hit = occurrencesOn(snap, date).find((o) => o.ruleId === ruleId)
    if (hit) return hit
  }
  return null
}

export default function RealApp() {
  const state = useStore()
  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_KEY) === '1' || store.state.courses.length > 0
    } catch {
      return store.state.courses.length > 0
    }
  })
  const [tab, setTab] = useState(0)
  const [anchor, setAnchor] = useState(todayStr)
  const [weekAnchor, setWeekAnchor] = useState(todayStr)
  const [stack, setStack] = useState<Route[]>([])
  const [menu, setMenu] = useState<{ occ: Occurrence; anchor: Rect; ghost: Ghost } | null>(null)
  const [searching, setSearching] = useState(false)
  const [compose, setCompose] = useState<{ courseId?: string } | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  /* 手机日历与小组件跟着数据走：Store 一变就重写、重画；回到前台再对一遍 */
  useEffect(() => {
    let timer: number | null = null
    const run = () => {
      scheduleCalendarSync()
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => void syncWidgets(), 400)
    }
    run()
    const off = store.subscribe(run)
    const onResume = CapApp.addListener('resume', () => {
      void syncCalendar()
      void syncWidgets()
    })
    /* 日历事件里的「在应用中打开」 */
    const onUrl = CapApp.addListener('appUrlOpen', ({ url }) => {
      const m = /^timetable:\/\/open\/(course|task|day)\/([^/?#]+)/.exec(url)
      if (!m) return
      const [, kind, id] = m
      setMenu(null)
      if (kind === 'course') {
        const c = store.state.courses.find((x) => x.id === id)
        setTab(0)
        setStack(c ? [{ k: 'course', course: c }] : [])
      } else if (kind === 'task') {
        const t = store.state.tasks.find((x) => x.id === id)
        setTab(2)
        setStack(t ? [{ k: 'todoDetail', task: t }] : [])
      } else {
        setTab(0)
        setStack([])
      }
    })
    /* 别人发来的 .ics 用课程表打开：直接进导入预览 */
    const offIcs = onIncomingIcs((text) => {
      setMenu(null)
      setTab(3)
      setStack([{ k: 'importRun', ruleId: 'builtin-ics', text, auto: true }])
    })
    return () => {
      off()
      offIcs()
      if (timer != null) window.clearTimeout(timer)
      void onResume.then((h) => h.remove())
      void onUrl.then((h) => h.remove())
    }
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)

  const snap = useMemo<Snapshot | null>(
    () => (state.semester ? { semester: state.semester, courses: state.courses, rules: state.rules, overrides: state.overrides, entries: state.entries } : null),
    [state],
  )
  /** 引导期间底下就把壳挂好，选完去向时内页推入不用等整个应用首次挂载 */
  const shellSnap = useMemo<Snapshot>(
    () => snap ?? { semester: defaultSemester(mondayOf(todayStr())), courses: [], rules: [], overrides: [], entries: [] },
    [snap],
  )

  const push = (r: Route) => { setMenu(null); setStack((s) => [...s, r]) }
  /*
   * 拍完/选完：给已有待办直接加照片并退回；新待办把确认页推在相机上方。
   * 相机留在栈里：确认页从右侧盖上去，底下是定格的取景框；重拍就是退回去，不会出现一页退一页进交叉。
   */
  const notShot = (r: Route) => r.k !== 'todoCamera' && r.k !== 'todoPicker' && r.k !== 'todoReview'
  const onPhotos = (photos: CapturedPhoto[], courseId?: string, taskId?: string) => {
    if (taskId) {
      store.addPhotos(taskId, photos.map((p) => ({ id: uid(), path: p.path, w: p.width, h: p.height, takenAt: Date.now() })))
      setStack((s) => s.filter(notShot))
      return
    }
    setStack((s) => [...s, { k: 'todoReview', photos, courseId }])
  }
  const openCapture = (kind: 'camera' | 'text', courseId?: string) => {
    if (kind === 'camera') push({ k: 'todoCamera', courseId })
    else setCompose({ courseId })
  }
  const pop = () => setStack((s) => s.slice(0, -1))
  const backToTimetable = () => { setStack([]); setTab(0) }
  /* 头像 / 背景：原生走相册页（单选），浏览器直接选文件；换掉的文件随手删 */
  const applyPhoto = (target: PhotoTarget, ps: CapturedPhoto[]) => {
    const p = ps[0]
    if (!p) return
    const old = store.state.prefs[target]
    const path = rememberPhoto(p).path
    store.setPrefs(target === 'avatar' ? { avatar: path } : { wall: path })
    if (old) void camera.remove([old])
  }
  const pickPhoto = async (target: PhotoTarget) => {
    if (nativeCamera()) push({ k: 'photoPick', target })
    else applyPhoto(target, await camera.pick())
  }
  /* 清除完：回到刚安装的样子，重新走引导 */
  const eraseDone = () => {
    try {
      localStorage.removeItem(ONBOARD_KEY)
    } catch {
      /* 忽略 */
    }
    setOnboardUnder(false)
    setOnboarded(false)
    setStack([])
    setTab(0)
  }
  const openCourseById = (id: string) => {
    const c = store.state.courses.find((x) => x.id === id)
    if (c) push({ k: 'course', course: c })
  }
  const openOccurrence = (o: Occurrence) => {
    if (o.courseId) openCourseById(o.courseId)
    else push({ k: 'session', occ: o })
  }

  /** 引导选了去向时：内页从右侧推入盖住引导；内页退回后有课才算完成，否则回到引导 */
  const [onboardUnder, setOnboardUnder] = useState(false)
  /* 内页退回的同一帧就把引导隐藏（visibility），不等 effect，避免退场动画期间露出引导页 */
  const onboardDone = onboardUnder && stack.length === 0 && state.courses.length > 0
  const showOnboard = !onboarded || !snap
  useEffect(() => {
    if (!onboardUnder || stack.length > 0) return
    if (store.state.courses.length === 0) {
      /* 没有课就回到引导：等内页滑出后再升回顶层，否则会盖住退场动画 */
      const t = window.setTimeout(() => setOnboardUnder(false), SLIDE.duration * 1000)
      return () => window.clearTimeout(t)
    }
    try {
      localStorage.setItem(ONBOARD_KEY, '1')
    } catch {
      /* 忽略 */
    }
    setOnboarded(true)
  }, [onboardUnder, stack.length])

  /* 有课表、还没拿到日历权限：每次启动推一次「加进手机日历」，拿到后全自动 */
  const calAsked = useRef(false)
  useEffect(() => {
    if (!onboarded || onboardUnder || stack.length > 0 || !calendarSupported() || calAsked.current) return
    if (state.courses.length === 0) return
    let alive = true
    void calendarPermission().then((p) => {
      if (!alive) return
      calAsked.current = true
      if (p === 'granted') void syncCalendar()
      else setStack((s) => (s.length === 0 ? [{ k: 'calendarIntro' }] : s))
    })
    return () => { alive = false }
  }, [onboarded, onboardUnder, stack.length, state.courses.length])

  /* 系统返回：先关浮层，再退内页，再回今天；引导期间退上一步 */
  const backRef = useRef<() => boolean>(() => false)
  const onboardBack = useRef<() => boolean>(() => false)
  backRef.current = () => {
    if (menu) { setMenu(null); return true }
    if (compose) { setCompose(null); return true }
    if (closeTopSheet()) return true
    if (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.k === 'todoCamera' && cameraLeave.current) void cameraLeave.current().then(pop)
      else setStack((s) => s.slice(0, -1))
      return true
    }
    if (showOnboard && !onboardUnder) return onboardBack.current()
    if (searching) { setSearching(false); return true }
    if (tab !== 0) { setTab(0); return true }
    return false
  }
  /* 栏空后再按一次才退出 */
  const exitArmed = useRef(0)
  useEffect(() => {
    const h = CapApp.addListener('backButton', () => {
      if (backRef.current()) { exitArmed.current = 0; return }
      const t = Date.now()
      if (t - exitArmed.current < 2000) { void CapApp.exitApp(); return }
      exitArmed.current = t
      nativeToast('再按一次退出')
    })
    return () => void h.then((x) => x.remove())
  }, [])

  const renderApp = (snap: Snapshot) => {
  const renderRoute = (r: Route, i: number) => {
    const key = `${r.k}-${i}`
    switch (r.k) {
      case 'course':
        return (
          <CourseDetailPage
            key={key}
            course={r.course}
            snap={snap}
            onBack={pop}
            onChanges={() => push({ k: 'changes', courseId: r.course.id })}
            onEdit={() => push({ k: 'courseEdit', course: r.course })}
            composing={compose?.courseId === r.course.id}
            onCapture={(kind) => openCapture(kind, r.course.id)}
            onOpenTask={(t) => push({ k: 'todoDetail', task: t })}
          />
        )
      case 'courseEdit':
        return (
          <CourseEditPage
            key={key}
            course={r.course}
            onBack={pop}
            onEditSession={(ruleId) => {
              const occ = occurrenceOfRule(snap, ruleId)
              if (occ) push({ k: 'session', occ })
            }}
          />
        )
      case 'session':
        return <EditSessionPage key={key} occ={r.occ} snap={snap} onBack={pop} />
      case 'conflict':
        return <ConflictPage key={key} occ={r.occ} snap={snap} onBack={pop} onCourse={openCourseById} />
      case 'changes':
        return <ChangePage key={key} courseId={r.courseId} onBack={pop} />
      case 'todoDetail':
        return (
          <TaskDetailPage
            key={key}
            task={r.task}
            snap={snap}
            onBack={pop}
            onCamera={() => push({ k: 'todoCamera', courseId: r.task.courseId, taskId: r.task.id })}
          />
        )
      case 'todoCamera':
        return (
          <CameraPage
            key={key}
            snap={snap}
            courseId={r.courseId}
            active={i === stack.length - 1}
            onBack={pop}
            onPicker={() => push({ k: 'todoPicker', courseId: r.courseId, taskId: r.taskId })}
            onShot={(photos, cid) => onPhotos(photos, cid, r.taskId)}
          />
        )
      case 'todoPicker':
        return <PickerPage key={key} onBack={pop} onDone={(photos) => onPhotos(photos, r.courseId, r.taskId)} />
      case 'todoReview':
        return (
          <ReviewPage
            key={key}
            snap={snap}
            photos={r.photos}
            courseId={r.courseId}
            onBack={pop}
            onRetake={() => setStack((s) => (s.some((x) => x.k === 'todoCamera') ? s.filter((x) => x.k !== 'todoPicker' && x.k !== 'todoReview') : [...s.filter(notShot), { k: 'todoCamera', courseId: r.courseId }]))}
            onSaved={() => setStack([])}
          />
        )
      case 'manual':
        return <ManualAddPage key={key} snap={snap} onBack={pop} />
      case 'import':
        return (
          <ImportPage
            key={key}
            onBack={pop}
            onManual={() => push({ k: 'manual' })}
            onEditRule={(x) => push({ k: 'rule', rule: x === 'new' ? null : x })}
            onRun={(ruleId) => push({ k: 'importRun', ruleId })}
            onAi={() => push({ k: 'aiImport' })}
          />
        )
      case 'aiImport':
        return <AiImportPage key={key} onBack={pop} onNext={(text) => push({ k: 'importRun', ruleId: 'builtin-json', text })} />
      case 'importRun': {
        const rule = state.savedRules.find((x) => x.id === r.ruleId)
        return rule ? <ImportRunPage key={key} rule={rule} initialText={r.text} autoRun={r.auto} onBack={pop} onDone={backToTimetable} /> : null
      }
      case 'rule':
        return <RuleEditorPage key={key} rule={r.rule} onBack={pop} />
      case 'semester':
        return <SemesterSettings key={key} sem={snap.semester} onBack={pop} />
      case 'history':
        return <HistoryPage key={key} onBack={pop} />
      case 'trash':
        return <TrashPage key={key} onBack={pop} />
      case 'notif':
        return <NotifPrefPage key={key} onBack={pop} onPick={(pref) => push({ k: 'notifPick', pref })} />
      case 'calendarIntro':
        return <CalendarIntroPage key={key} onDone={pop} />
      case 'notifPick':
        return <PrefPickPage key={key} pref={r.pref} onBack={pop} />
      case 'widget':
        return <WidgetPage key={key} snap={snap} onBack={pop} />
      case 'theme':
        return <ThemePage key={key} onBack={pop} />
      case 'profile':
        return <ProfilePage key={key} onBack={pop} onPick={(t) => void pickPhoto(t)} />
      case 'photoPick':
        return <PickerPage key={key} single onBack={pop} onDone={(ps) => { applyPhoto(r.target, ps); pop() }} />
      case 'stats':
        return <StatsPage key={key} onBack={pop} onCourse={(c) => push({ k: 'course', course: c })} onChanges={() => push({ k: 'changes' })} onTodo={() => { setStack([]); setTab(2) }} />
      case 'erase':
        return <ErasePage key={key} onBack={pop} onDone={eraseDone} />
      case 'courses':
        return (
          <CoursesPage
            key={key}
            onBack={pop}
            onDetail={(c) => push({ k: 'course', course: c })}
            onManual={() => push({ k: 'manual' })}
          />
        )
    }
  }

  const mo = menu?.occ
  const ovr = (kind: OverrideKind) => {
    if (!mo?.ruleId) return
    store.addOverride({ id: uid(), kind, date: mo.date, ruleId: mo.ruleId, createdAt: Date.now() })
    setMenu(null)
  }
  const restore = () => {
    if (!mo?.ruleId) return
    store.removeOverride(mo.ruleId, mo.date)
    setMenu(null)
  }
  const undoTitle = mo
    ? mo.status === 'leave' ? '取消请假'
      : mo.status === 'cancelled' ? '恢复上课'
      : mo.status === 'moved' ? '恢复原时间'
      : null
    : null

  return (
    <Shell tab={tab} onTab={(i) => { setStack([]); setTab(i) }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          data-veil-host
          className="relative flex flex-1 flex-col overflow-hidden"
        >
          {tab === 0 && (
            <TodayView
              snap={snap}
              anchor={anchor}
              setAnchor={setAnchor}
              onPick={openOccurrence}
              onMenu={(o, a, el) => {
                const pad = 10
                setMenu({
                  occ: o,
                  anchor: { x: a.x - pad, y: a.y - pad, w: a.w + pad * 2, h: a.h + pad * 2 },
                  ghost: { el, rect: a, radius: 16, scale: 1.015, bg: 'var(--c-surface)', pad },
                })
              }}
              liftKey={menu?.occ.key}
              onSearch={() => setSearching(true)}
              onImport={() => push({ k: 'import' })}
              onManual={() => push({ k: 'manual' })}
              onCapture={openCapture}
            />
          )}
          {tab === 1 && (
            <WeekView
              snap={snap}
              anchor={weekAnchor}
              setAnchor={setWeekAnchor}
              onPick={openOccurrence}
              onMenu={(o, a, el) => setMenu({ occ: o, anchor: a, ghost: { el, rect: a, color: o.color, radius: 9, scale: 1.06 } })}
              liftKey={menu?.occ.key}
              onSearch={() => setSearching(true)}
            />
          )}
          {tab === 2 && (
            <TodoView
              snap={snap}
              composing={compose != null && compose.courseId == null}
              onOpen={(t) => push({ k: 'todoDetail', task: t })}
              onCamera={() => push({ k: 'todoCamera' })}
              onText={() => setCompose({})}
            />
          )}
          {tab === 3 && <MeView onPage={(p) => { if (p === 'share') void shareIcs().then((ok) => { if (!ok) nativeToast('先设置学期') }); else push({ k: p } as Route) }} />}
        </motion.div>
      </AnimatePresence>

      {/* 搜索：盖在 Tab 上的浮层（淡入带一点上浮），位于内页之下：从搜索点进课程再返回，回到的是搜索 */}
      <AnimatePresence>
        {searching && (
          <motion.div
            key="search"
            initial={{ opacity: 0, transform: 'translateY(14px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transform: 'translateY(10px)' }}
            transition={SHEET}
            className="absolute inset-0 z-[35] flex flex-col bg-(--c-bg) will-change-transform"
          >
            <SearchPalette
              state={state}
              onClose={() => setSearching(false)}
              onPickCourse={(c) => push({ k: 'course', course: c })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {compose && (
          <ComposeOverlay
            key="compose"
            snap={snap}
            courseId={compose.courseId}
            onClose={() => setCompose(null)}
            onCamera={() => { const cid = compose.courseId; setCompose(null); push({ k: 'todoCamera', courseId: cid }) }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{stack.map((r, i) => renderRoute(r, i))}</AnimatePresence>

      <AnimatePresence>
        {menu && mo && (
          <Popover key="quick" anchor={menu.anchor} ghost={menu.ghost} onClose={() => setMenu(null)}>
            <PopHead title={mo.name} sub={fmtMinutes(mo.start)} />
            {mo.ruleId && undoTitle && <PopItem icon={ICON.undo} title={undoTitle} onClick={restore} />}
            {mo.ruleId && mo.status === 'normal' && <PopItem icon={ICON.leave} title="请假一次" onClick={() => ovr('leave')} />}
            {mo.ruleId && mo.status === 'normal' && <PopItem icon={ICON.bell} title={mo.muted ? '取消静音' : '静音本节'} onClick={() => (mo.muted ? restore() : ovr('muted'))} />}
            {mo.ruleId && mo.status !== 'cancelled' && <PopItem icon={ICON.clock} title="调整时间" onClick={() => { setMenu(null); push({ k: 'session', occ: mo }) }} />}
            {mo.conflict && <PopItem icon={ICON.info} title="查看冲突" onClick={() => { setMenu(null); push({ k: 'conflict', occ: mo }) }} />}
            {mo.courseId && (
              <PopItem
                icon={ICON.edit}
                title="编辑课程"
                onClick={() => {
                  const c = store.state.courses.find((x) => x.id === mo.courseId)
                  setMenu(null)
                  if (c) push({ k: 'courseEdit', course: c })
                }}
              />
            )}
            {mo.ruleId && mo.status === 'normal' && <PopItem icon={ICON.ban} title="本节停课" danger onClick={() => ovr('cancelled')} />}
            {mo.entryId && <PopItem icon={ICON.trash} title="删除这条安排" danger onClick={() => { store.removeEntry(mo.entryId!); setMenu(null) }} />}
          </Popover>
        )}
      </AnimatePresence>

    </Shell>
  )
  }

  return (
    <div ref={rootRef} className="relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden bg-(--c-bg)">
      {renderApp(shellSnap)}
      <AnimatePresence initial={false}>
        {showOnboard && (
          <motion.div
            key="onboarding"
            exit={onboardUnder ? { opacity: 1 } : { transform: 'translateX(-28%)', opacity: 0 }}
            transition={onboardUnder ? { duration: 0 } : SLIDE}
            className={`absolute inset-0 ${onboardUnder ? 'z-[35]' : 'z-[90]'}`}
            style={{ visibility: onboardDone ? 'hidden' : 'visible' }}
          >
            <Onboarding
              backRef={onboardBack}
              onDone={(ruleId) => {
                if (!ruleId) {
                  try {
                    localStorage.setItem(ONBOARD_KEY, '1')
                  } catch {
                    /* 忽略 */
                  }
                  setOnboarded(true)
                  return
                }
                setOnboardUnder(true)
                if (ruleId === 'manual') push({ k: 'manual' })
                else if (ruleId === 'ai') push({ k: 'aiImport' })
                else push({ k: 'importRun', ruleId })
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
