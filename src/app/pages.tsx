import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Course, Occurrence, OverrideKind, Task, UserEntry } from '../domain/types'
import { dateOf, fmtDuration, fmtMinutes, fromDate, weekdayOf } from '../domain/dates'
import { occurrencesOn, type Snapshot } from '../domain/engine'
import { maskHasWeek } from '../domain/weeks'
import { COURSE_COLORS } from '../domain/palette'
import { uid } from '../domain/store'
import { store, useStore } from './store'
import { defaultSemester, mondayOf, nowMinutes, todayStr } from './semester'
import {
  BottomVeil, Card, Chips, EmptyBlock, Field, ICON, MenuRow, Page, PrimaryButton,
  StickyHead, TextAction, TextInput, TopBar, WD, WD_SHORT, md, tint,
  DateInput, TimeInput, SelectInput,
} from './ui'
import { CourseTasks } from './todo'

/** 格式化手机号：138 **** 1234 */
function formatPhone(phone: string): string {
  if (phone.length < 7) return phone
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`
}

/** 规则的钟点区间：14:30 – 16:00；节次表里查不到时回退到节次 */
function ruleClock(grid: { index: number; start: number; end: number }[] | undefined, r: { startPeriod: number; endPeriod: number }): string {
  const s = grid?.find((t) => t.index === r.startPeriod)
  const e = grid?.find((t) => t.index === r.endPeriod)
  return s && e ? `${fmtMinutes(s.start)} – ${fmtMinutes(e.end)}` : rulePeriods(r)
}

function rulePeriods(r: { startPeriod: number; endPeriod: number }): string {
  return r.startPeriod === r.endPeriod ? `第 ${r.startPeriod} 节` : `第 ${r.startPeriod}–${r.endPeriod} 节`
}

function sortRules<T extends { weekday: number; startPeriod: number }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod)
}

/** 同一天前后相连、地点与周次相同的规则合并成一段：第 6–7 节 + 第 8–9 节 → 14:30 – 17:40 */
function mergeRules<T extends { weekday: number; startPeriod: number; endPeriod: number; location?: string; weeksMask: bigint }>(rules: T[]) {
  const out: { weekday: number; startPeriod: number; endPeriod: number; location?: string; weeksMask: bigint }[] = []
  for (const r of sortRules(rules)) {
    const last = out[out.length - 1]
    if (last && last.weekday === r.weekday && last.endPeriod + 1 === r.startPeriod && last.location === r.location && last.weeksMask === r.weeksMask) {
      last.endPeriod = r.endPeriod
    } else {
      out.push({ weekday: r.weekday, startPeriod: r.startPeriod, endPeriod: r.endPeriod, location: r.location, weeksMask: r.weeksMask })
    }
  }
  return out
}

/** 具体某天的口语化说法：今天 / 明天 / 3 天后 周四 / 9月7日 周一 */
function dayLabel(date: string, today: string): string {
  const diff = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  const wd = WD[weekdayOf(date)]
  if (diff > 2 && diff < 14) return `${diff} 天后 ${wd}`
  return `${md(date)} ${wd}`
}

function PageFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">{children}</div>
  )
}

/** 节次选择：横向 1..n，显示所选区间的钟点 */
function PeriodPicker({
  grid, sp, ep, onPick,
}: {
  grid: { index: number; start: number; end: number }[]
  sp: number
  ep: number
  onPick: (sp: number, ep: number) => void
}) {
  const s = grid.find((t) => t.index === sp)
  const e = grid.find((t) => t.index === ep)
  /* 和颜色选择器同一套：固定宽横向滚动 + 两端渐变；挂载时把所选区间滚到中间 */
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = row.current
    if (!el) return
    const a = el.querySelector<HTMLElement>(`[data-p="${sp}"]`)
    const b = el.querySelector<HTMLElement>(`[data-p="${ep}"]`)
    if (!a || !b) return
    el.scrollLeft = Math.max(0, (a.offsetLeft + b.offsetLeft + b.offsetWidth) / 2 - el.clientWidth / 2)
  }, [])
  const fade = 'linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)'
  return (
    <div className="rounded-[16px] bg-(--c-surface) py-3.5">
      <div className="flex items-baseline justify-between px-4">
        <span className="text-[12.5px] font-medium text-(--c-ink4)">节次</span>
        <span className="text-[13px] font-bold tabular-nums text-(--c-ink)">
          {sp === ep ? `第 ${sp} 节` : `第 ${sp}–${ep} 节`}
          {s && e && <span className="ml-2 font-semibold text-(--c-ink4)">{fmtMinutes(s.start)} – {fmtMinutes(e.end)}</span>}
        </span>
      </div>
      <div
        ref={row}
        className="mt-2.5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        {grid.map((t) => {
          const on = t.index >= sp && t.index <= ep
          return (
            <button
              key={t.index}
              data-p={t.index}
              onClick={() => (t.index < sp ? onPick(t.index, ep) : t.index > ep ? onPick(sp, t.index) : onPick(t.index, t.index))}
              className={`h-[30px] w-[38px] flex-none rounded-[9px] text-[12px] font-bold tabular-nums transition-colors ${on ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-bg) text-(--c-ink4)'}`}
            >
              {t.index}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const TASK_KINDS: Task['kind'][] = ['homework', 'exam', 'memo']
const TASK_LABEL: Record<Task['kind'], string> = { homework: '作业', exam: '考试', memo: '备忘' }

function PageBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none] ${className}`}>
      {children}
    </div>
  )
}

/* ---------------- 课程详情（内页） ---------------- */

export function CourseDetailPage({
  course, snap, composing, onBack, onChanges, onEdit, onCapture, onOpenTask,
}: {
  course: Course
  snap: Snapshot
  onBack: () => void
  onChanges: () => void
  onEdit: () => void
  composing: boolean
  onCapture: (kind: 'camera' | 'text') => void
  onOpenTask: (t: Task) => void
}) {
  const state = useStore()
  const cur = state.courses.find((c) => c.id === course.id) ?? course
  const rules = state.rules.filter((r) => r.courseId === cur.id)
  const today = todayStr()
  const now = nowMinutes()
  const sem = snap.semester

  /** 这门课在整个学期展开出的每一次，用于进度与出勤 */
  const sessions = useMemo(() => {
    const out: { date: string; ruleId: string; startPeriod: number; endPeriod: number; start: number; end: number; location?: string }[] = []
    for (const r of rules) {
      for (let w = 1; w <= sem.totalWeeks; w++) {
        if (!maskHasWeek(r.weeksMask, w)) continue
        const date = dateOf(sem, w, r.weekday)
        const s = sem.timeGrid.find((t) => t.index === r.startPeriod)
        const e = sem.timeGrid.find((t) => t.index === r.endPeriod)
        out.push({ date, ruleId: r.id, startPeriod: r.startPeriod, endPeriod: r.endPeriod, start: s?.start ?? 0, end: e?.end ?? 0, location: r.location })
      }
    }
    return out.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
  }, [rules, sem])

  const ovOf = (ruleId: string, date: string) => state.overrides.find((o) => o.ruleId === ruleId && o.date === date)
  const passed = sessions.filter((s) => s.date < today || (s.date === today && s.end <= now))
  const next = sessions.find((s) => s.date > today || (s.date === today && s.end > now))
  const attended = passed.filter((s) => ovOf(s.ruleId, s.date)?.kind !== 'leave' && ovOf(s.ruleId, s.date)?.kind !== 'cancelled')
  const absent = passed.filter((s) => ovOf(s.ruleId, s.date)?.kind === 'leave')
  const rate = passed.length > 0 ? Math.round((attended.length / passed.length) * 100) : 0
  const weeksSpan = sessions.length > 0 ? `${md(sessions[0].date)} – ${md(sessions[sessions.length - 1].date)}` : ''
  const tasks = state.tasks.filter((t) => t.courseId === cur.id)
  const changes = state.changes.filter((c) => c.target === cur.id || rules.some((r) => r.id === c.target))

  const merged = mergeRules(rules)
  const todayWd = weekdayOf(today)
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-4 pb-10 [scrollbar-width:none]">
        <TopBar
          title={cur.name}
          onBack={onBack}
          trail={
            <button
              onClick={onEdit}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-accent2)' }} strokeWidth="2" strokeLinecap="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
            </button>
          }
        />

        <div className="mt-3 space-y-3">
        <Card>
          <div className="flex items-start justify-between">
            <div className="text-[12.5px] font-medium text-(--c-ink3)">
              {[cur.source === 'import' ? '规则导入' : '手动添加', weeksSpan].filter(Boolean).join('，')}
            </div>
            <i className="mt-1 ml-3 h-[10px] w-[10px] flex-none rounded-full" style={{ background: cur.color }} />
          </div>
          <div className="mt-5">
            {([
              ['下次上课', next ? <span className="tabular-nums">{dayLabel(next.date, today)} {fmtMinutes(next.start)} – {fmtMinutes(next.end)}</span> : '本学期已上完'],
              ['地点', [...new Set(rules.map((r) => r.location).filter(Boolean))].join('、') || '—'],
              ['老师', [...new Set([cur.teacher, ...rules.map((r) => r.teacher)].filter(Boolean))].join('、') || '—'],
              ...(cur.teacherPhone ? [['教师电话', (
                <a href={`tel:${cur.teacherPhone}`} className="inline-flex items-center gap-1 text-(--c-accent)">
                  <span className="font-semibold tabular-nums">{formatPhone(cur.teacherPhone)}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </a>
              )] as [string, React.ReactNode]] : []),
            ] as [string, React.ReactNode][]).map(([k, v], i) => (
              <div key={k} className={`flex items-baseline ${i > 0 ? 'mt-4' : ''}`}>
                <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">{k}</span>
                <span className="text-[14px] text-(--c-ink)">{v}</span>
              </div>
            ))}
          </div>

          {merged.length > 0 && (
            <div className="mt-5">
              <div className="grid grid-cols-7 gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                  const segs = merged.filter((m) => m.weekday === wd)
                  const on = segs.length > 0
                  return (
                    <div key={wd} className="flex flex-col items-center">
                      <span className={`text-[11px] font-bold ${wd === todayWd ? 'text-(--c-accent)' : 'text-(--c-ink4)'}`}>{WD_SHORT[wd]}</span>
                      <div
                        className={`mt-1.5 flex w-full flex-col items-center justify-center rounded-[10px] py-2 ${on ? '' : 'bg-(--c-bg)'}`}
                        style={on ? { background: tint(cur.color, 22), minHeight: 46 } : { minHeight: 46 }}
                      >
                        {on ? segs.map((m, i) => {
                          const s = sem.timeGrid.find((t) => t.index === m.startPeriod)
                          const e = sem.timeGrid.find((t) => t.index === m.endPeriod)
                          return (
                            <span key={i} className={`flex flex-col items-center text-[10.5px] font-bold leading-[1.35] tabular-nums text-(--c-ink) ${i > 0 ? 'mt-1.5' : ''}`}>
                              <span>{s ? fmtMinutes(s.start) : `第${m.startPeriod}节`}</span>
                              <span className="text-(--c-ink4)">{e ? fmtMinutes(e.end) : `第${m.endPeriod}节`}</span>
                            </span>
                          )
                        }) : <span className="text-[11px] font-medium text-(--c-ink5)">–</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline">
            <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">学期进度</span>
            <span className="text-[14px] font-semibold tabular-nums text-(--c-ink)">{passed.length} / {sessions.length} 次</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-(--c-surface2)">
            <i className="block h-full rounded-full bg-(--c-accent)" style={{ width: `${sessions.length ? (passed.length / sessions.length) * 100 : 0}%` }} />
          </div>
          <div className="mt-4 flex items-baseline">
            <span className="w-[72px] flex-none text-[13px] font-medium text-(--c-ink4)">出勤</span>
            <span className="text-[14px] font-semibold tabular-nums text-(--c-ink)">
              {passed.length === 0 ? '—' : `${attended.length} / ${passed.length}，出勤率 ${rate}%`}
            </span>
          </div>
          {passed.length > 0 && (
            <div className="mt-3 flex gap-1.5">
              {sessions.slice(0, 12).map((s) => {
                const ov = ovOf(s.ruleId, s.date)
                const done = s.date < today || (s.date === today && s.end <= now)
                const cls = !done ? 'bg-(--c-surface2)' : ov?.kind === 'leave' ? 'bg-(--c-ink5)' : ov?.kind === 'cancelled' ? 'bg-(--c-surface2)' : 'bg-(--c-accent)'
                return <div key={s.ruleId + s.date} className={`h-1 flex-1 rounded-full ${cls}`} />
              })}
            </div>
          )}
          {absent.length > 0 && <div className="mt-2.5 text-[11.5px] font-medium text-(--c-ink5)">请假 {absent.length} 次</div>}
        </Card>

        <Card>
          <CourseTasks
            tasks={tasks}
            course={cur}
            composing={composing}
            onOpen={onOpenTask}
            onCamera={() => onCapture('camera')}
            onText={() => onCapture('text')}
          />
        </Card>

        <div className="overflow-hidden rounded-[20px] bg-(--c-surface)">
          <MenuRow icon={ICON.undo} title="变更记录" desc={changes.length > 0 ? `${changes.length} 条` : '还没有变更'} onClick={onChanges} />
          <MenuRow icon={ICON.ban} title={cur.hidden ? '取消隐藏' : '隐藏这门课'} desc="隐藏后不出现在课表里，可恢复" onClick={() => store.setCourseHidden(cur.id, !cur.hidden)} />
        </div>
        </div>
      </div>
    </Page>
  )
}

/* ---------------- 编辑课程（内页） ---------------- */

export function CourseEditPage({ course, onBack, onEditSession }: { course: Course; onBack: () => void; onEditSession: (ruleId: string) => void }) {
  const state = useStore()
  const cur = state.courses.find((c) => c.id === course.id) ?? course
  const [name, setName] = useState(cur.name)
  const [teacher, setTeacher] = useState(cur.teacher ?? '')
  const [teacherPhone, setTeacherPhone] = useState(cur.teacherPhone ?? '')
  const [category, setCategory] = useState(cur.category ?? '')
  const [color, setColor] = useState(cur.color)
  const colorRow = useRef<HTMLDivElement>(null)
  /* 老数据里不在色板上的颜色放在最前面，让当前颜色总有一个被选中 */
  const COLORS = COURSE_COLORS.includes(cur.color) ? COURSE_COLORS : [cur.color, ...COURSE_COLORS]
  useEffect(() => {
    const el = colorRow.current
    const i = COLORS.indexOf(cur.color)
    if (el && i >= 0) el.scrollLeft = Math.max(0, i * 32 - 140)
  }, [cur.color])
  const rules = state.rules.filter((r) => r.courseId === cur.id)

  const dirty =
    name.trim() !== cur.name ||
    teacher.trim() !== (cur.teacher ?? '') ||
    teacherPhone.trim() !== (cur.teacherPhone ?? '') ||
    category.trim() !== (cur.category ?? '') ||
    color !== cur.color

  const save = () => {
    const cleanPhone = teacherPhone.replace(/[\s\-]/g, '').replace(/^\+?86/, '') || undefined
    store.editCourse(cur.id, {
      name: name.trim() || cur.name,
      teacher: teacher.trim() || undefined,
      teacherPhone: cleanPhone && /^1[3-9]\d{9}$/.test(cleanPhone) ? cleanPhone : undefined,
      category: category.trim() || undefined,
      color,
    })
    onBack()
  }

  return (
    <Page>
      <PageBody>
        <TopBar title="编辑课程" onBack={onBack} />

        <div className="mt-5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Field k="名称"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field k="老师"><TextInput value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="可选" /></Field>
          <Field k="教师电话"><TextInput value={teacherPhone} inputMode="tel" onChange={(e) => setTeacherPhone(e.target.value)} placeholder="可选，用于一键拨号" /></Field>
          <Field k="分类"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="必修、选修等，可选" /></Field>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <span className="flex-none text-[12.5px] font-medium whitespace-nowrap text-(--c-ink4)">颜色</span>
          <div
            className="flex w-[196px] flex-none items-center gap-2.5 overflow-x-auto px-[7px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ maskImage: 'linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent)' }}
            ref={colorRow}
          >
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full transition-transform duration-150 active:scale-[.9]"
                style={{ background: tint(c, 22), boxShadow: color === c ? `inset 0 0 0 1.6px ${c}` : undefined }}
              >
                <i className="h-[8px] w-[8px] rounded-full" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>

        {rules.length > 0 && (
          <>
            <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">上课时间</div>
            <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
              {sortRules(rules).map((r) => (
                <button key={r.id} onClick={() => onEditSession(r.id)} className="flex w-full items-center px-4 py-3 text-left active:bg-(--c-surface2)">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold tabular-nums text-(--c-ink)">{WD[r.weekday]} {ruleClock(state.semester?.timeGrid, r)}</div>
                    {r.location && <div className="mt-0.5 text-[12px] font-medium text-(--c-ink4)">{r.location}</div>}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink5)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
          <button
            onClick={() => { store.setCourseHidden(cur.id, !cur.hidden); onBack() }}
            className="w-full px-4 py-3.5 text-left text-[13.5px] font-bold text-(--c-rose) transition-colors active:bg-(--c-bg)"
          >
            {cur.hidden ? '取消隐藏' : '隐藏这门课'}
          </button>
        </div>
      </PageBody>

      <PageFooter>
        <PrimaryButton disabled={!dirty} onClick={save}>保存</PrimaryButton>
      </PageFooter>
    </Page>
  )
}

/* ---------------- 手动添加（内页） ---------------- */

export function ManualAddPage({ snap, onBack }: { snap: Snapshot | null; onBack: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState(0)
  const [weekly, setWeekly] = useState(true)
  const [weekday, setWeekday] = useState(weekdayOf(todayStr()))
  const [date, setDate] = useState(todayStr())
  const [sp, setSp] = useState(1)
  const [ep, setEp] = useState(2)
  const [loc, setLoc] = useState('')
  const sem = snap?.semester
  const grid = sem?.timeGrid
  const timeText = (() => {
    const s = grid?.find((t) => t.index === sp)
    const e = grid?.find((t) => t.index === ep)
    return s && e ? `${fmtMinutes(s.start)} – ${fmtMinutes(e.end)}` : ''
  })()

  /** 同一天已有的安排，用于提前提示重叠 */
  const clash = useMemo(() => {
    if (!snap) return []
    const d = weekly
      ? (() => {
          const base = new Date(`${todayStr()}T00:00:00`)
          const cur = base.getDay() === 0 ? 7 : base.getDay()
          base.setDate(base.getDate() + (weekday - cur))
          return base.toISOString().slice(0, 10)
        })()
      : date
    return occurrencesOn(snap, d).filter((o) => o.startPeriod <= ep && o.endPeriod >= sp && o.status !== 'cancelled')
  }, [snap, weekly, weekday, date, sp, ep])

  const save = () => {
    if (!store.state.semester) store.setSemester(defaultSemester(mondayOf(todayStr())))
    const en: UserEntry = {
      id: uid(),
      semesterId: store.state.semester?.id ?? '',
      name: name.trim(),
      kind: kind === 1 ? 'study' : 'temp',
      startPeriod: sp,
      endPeriod: ep,
      location: loc.trim() || undefined,
      createdAt: Date.now(),
      ...(weekly ? { weekday } : { date }),
    }
    store.addEntry(en)
    onBack()
  }

  return (
    <Page>
      <PageBody>
        <TopBar title="手动添加" onBack={onBack} />

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">类型</div>
        <div className="mt-2.5"><Chips items={['临时安排', '自习']} active={kind} onPick={setKind} /></div>

        <div className="mt-4 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          <Field k="名称"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 数据结构复习" /></Field>
          <Field k="重复">
            <div className="flex gap-1.5">
              <button onClick={() => setWeekly(false)} className={`rounded-[9px] px-2.5 py-[5px] text-[12px] font-bold ${!weekly ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-bg) text-(--c-ink3)'}`}>仅本次</button>
              <button onClick={() => setWeekly(true)} className={`rounded-[9px] px-2.5 py-[5px] text-[12px] font-bold ${weekly ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'bg-(--c-bg) text-(--c-ink3)'}`}>每周</button>
            </div>
          </Field>
          {weekly ? (
            <Field k="星期">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                  <button key={w} onClick={() => setWeekday(w)} className={`flex-1 rounded-[9px] py-[5px] text-[12px] font-bold ${weekday === w ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'text-(--c-ink3)'}`}>{WD_SHORT[w]}</button>
                ))}
              </div>
            </Field>
          ) : (
            <Field k="日期"><DateInput value={date} onChange={setDate} /></Field>
          )}
          <Field k="地点"><TextInput value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="可选" /></Field>
        </div>

        {grid && (
          <div className="mt-2.5">
            <PeriodPicker grid={grid} sp={sp} ep={ep} onPick={(a, b) => { setSp(a); setEp(b) }} />
          </div>
        )}

        {clash.length > 0 && (
          <div className="mt-3 rounded-[16px] bg-(--c-amber-soft) px-4 py-3.5">
            <div className="text-[12.5px] font-bold text-(--c-amber)">这个时间已有 {clash.length} 项安排</div>
            <div className="mt-1 text-[12px] font-medium text-(--c-ink4)">
              {clash.map((o) => `${o.name} ${o.startPeriod}–${o.endPeriod} 节`).join('；')}
            </div>
          </div>
        )}

      </PageBody>

      <PageFooter>
        <PrimaryButton disabled={!name.trim() || ep < sp} onClick={save}>添加</PrimaryButton>
      </PageFooter>
    </Page>
  )
}

/* ---------------- 课程冲突（内页） ---------------- */

export function ConflictPage({
  occ, snap, onBack, onCourse,
}: {
  occ: Occurrence
  snap: Snapshot
  onBack: () => void
  onCourse: (courseId: string) => void
}) {
  const state = useStore()
  const [pick, setPick] = useState(false)
  const sameDay = occurrencesOn(snap, occ.date).filter((o) => o.status !== 'cancelled')
  const others = sameDay.filter((o) => o.key !== occ.key && o.startPeriod <= occ.endPeriod && o.endPeriod >= occ.startPeriod)
  const group = [occ, ...others]
  const overlapStart = Math.max(...group.map((o) => o.start))
  const overlapEnd = Math.min(...group.map((o) => o.end))
  const overlapPeriods = `${Math.max(...group.map((o) => o.startPeriod))}–${Math.min(...group.map((o) => o.endPeriod))}`

  const keepOnly = (keepKey: string) => {
    for (const o of group) {
      if (o.key === keepKey) continue
      if (o.ruleId) store.addOverride({ id: uid(), ruleId: o.ruleId, date: o.date, kind: 'cancelled', note: '冲突时只留一门', createdAt: Date.now() })
    }
    onBack()
  }

  return (
    <Page>
      <PageBody>
        <TopBar title="课程冲突" sub={`${md(occ.date)} ${WD[occ.weekday]}，第 ${overlapPeriods} 节重叠`} onBack={onBack} />

        <div className="mt-5 rounded-[16px] bg-(--c-amber-soft) px-4 py-3.5">
          <div className="text-[12.5px] font-bold text-(--c-amber)">{group.length} 门课占用同一时段</div>
          <div className="mt-1 text-[12px] font-medium text-(--c-ink4)">
            重叠 {fmtMinutes(overlapStart)} – {fmtMinutes(overlapEnd)}，共 {fmtDuration(overlapEnd - overlapStart)}
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {group.map((o) => {
            const course = state.courses.find((c) => c.id === o.courseId)
            return (
              <div key={o.key} className="overflow-hidden rounded-[16px] bg-(--c-surface)">
                <div className="flex items-start px-4 pt-4">
                  <i className="mt-1 mr-3 h-[30px] w-[3px] flex-none rounded-full" style={{ background: o.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-extrabold tracking-[-.01em]">{o.name}</div>
                    <div className="mt-1 text-[12.5px] font-medium text-(--c-ink3)">
                      {fmtMinutes(o.start)} – {fmtMinutes(o.end)}，第 {o.startPeriod}–{o.endPeriod} 节
                      {o.location ? `，${o.location}` : ''}
                    </div>
                    <div className="mt-0.5 text-[12px] font-medium text-(--c-ink5)">
                      {[o.teacher, o.source === 'import' ? '规则导入' : '手动添加'].filter(Boolean).join('，')}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-5 px-4 pb-3.5">
                  {course && <TextAction tone="mute" onClick={() => onCourse(course.id)}>课程详情</TextAction>}
                  {pick && <TextAction onClick={() => keepOnly(o.key)}>只留这门</TextAction>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-[12px] font-medium text-(--c-ink5)">{pick ? '其余几门仅本次停课' : '两门都保留时，课表里并列显示'}</span>
          {pick ? (
            <TextAction tone="mute" onClick={() => setPick(false)}>返回</TextAction>
          ) : (
            <TextAction onClick={() => setPick(true)}>只留一门</TextAction>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

/* ---------------- 变更记录（内页） ---------------- */

const FIELD_LABEL: Record<string, string> = {
  name: '名称', teacher: '老师', credit: '学分', color: '颜色',
  location: '地点', weekday: '星期', startPeriod: '起始节次', endPeriod: '结束节次',
}

/** 单节状态：undefined 表示正常上课 */
const STATUS: [OverrideKind | undefined, string][] = [
  [undefined, '正常'],
  ['leave', '请假'],
  ['cancelled', '停课'],
  ['muted', '静音'],
]

const OV_WHAT: Record<string, string> = {
  moved: '调课', cancelled: '停课', leave: '请假', done: '已上', muted: '静音',
}
/** 与首页课程行同一套 Badge 配色 */
const BADGE: Record<string, string> = {
  moved: 'bg-(--c-accent-soft) text-(--c-accent)',
  leave: 'bg-(--c-rose-soft) text-(--c-rose)',
  edit: 'bg-(--c-amber-soft) text-(--c-amber)',
}
function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span className={`flex-none rounded-[7px] px-2 py-[3px] text-[10.5px] font-bold ${BADGE[kind] ?? 'bg-(--c-surface2) text-(--c-ink3)'}`}>{children}</span>
  )
}

export function ChangePage({ courseId, onBack }: { courseId?: string; onBack: () => void }) {
  const state = useStore()
  const courseOfTarget = (target: string) =>
    state.courses.find((x) => x.id === target) ??
    state.courses.find((x) => x.id === state.rules.find((r) => r.id === target)?.courseId)
  const fmtVal = (field: string, v?: string) => (field === 'weekday' && v ? WD[Number(v)] : v || '空')
  const periods = (a?: number, b?: number) => (a == null || b == null ? '' : a === b ? `${a} 节` : `${a}–${b} 节`)

  type Row = { key: string; at: number; date: string; course: string; kind: string; what: string; why: string; undo?: () => void }
  const rows: Row[] = []
  for (const c of state.changes) {
    const co = courseOfTarget(c.target)
    if (courseId && co?.id !== courseId) continue
    const label = FIELD_LABEL[c.field] ?? c.field
    rows.push({
      key: c.id, at: c.at, date: md(fromDate(new Date(c.at))), course: co?.name ?? '课程', kind: 'edit',
      what: c.field === 'location' ? '换教室' : `改${label}`,
      why: `${fmtVal(c.field, c.from)} → ${fmtVal(c.field, c.to)}，${c.actor === 'import' ? '导入' : '手动'}`,
    })
  }
  for (const o of state.overrides) {
    const rule = state.rules.find((r) => r.id === o.ruleId)
    const co = rule && state.courses.find((x) => x.id === rule.courseId)
    if (courseId && co?.id !== courseId) continue
    const base = periods(rule?.startPeriod, rule?.endPeriod)
    const why =
      o.kind === 'moved'
        ? [`${md(o.date)} ${base} → ${md(o.newDate ?? o.date)} ${periods(o.newStartPeriod ?? rule?.startPeriod, o.newEndPeriod ?? rule?.endPeriod)}`, o.newLocation && `改到 ${o.newLocation}`, o.newTeacher && `老师 ${o.newTeacher}`, o.note]
        : [base, o.note]
    rows.push({
      key: o.id, at: o.createdAt, date: md(o.date), course: co?.name ?? '课程', kind: o.kind,
      what: OV_WHAT[o.kind] ?? o.kind, why: why.filter(Boolean).join('，'),
      undo: () => store.removeOverride(o.ruleId, o.date),
    })
  }
  rows.sort((a, b) => b.at - a.at)
  const courseName = courseId ? state.courses.find((c) => c.id === courseId)?.name : undefined

  return (
    <Page>
      <PageBody>
        <TopBar title="变更记录" sub={rows.length > 0 ? [courseName, `共 ${rows.length} 条`].filter(Boolean).join('，') : undefined} onBack={onBack} />
        {rows.length === 0 ? (
          <div className="mt-14"><EmptyBlock kind="free" title="还没有变更" /></div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
            {rows.map((r, i) => (
              <div key={r.key} className={`flex items-baseline px-4 py-2.5 ${i > 0 ? 'border-t border-(--c-surface2)' : ''}`}>
                <span className="w-[58px] flex-none text-[11.5px] font-semibold tabular-nums text-(--c-ink5)">{r.date}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-bold text-(--c-ink)">{courseId ? r.why || r.what : r.course}</span>
                    <Badge kind={r.kind}>{r.what}</Badge>
                  </div>
                  {!courseId && r.why && <div className="mt-[3px] text-[11.5px] font-medium text-(--c-ink4)">{r.why}</div>}
                </div>
                {r.undo && <TextAction tone="mute" onClick={r.undo}>撤销</TextAction>}
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  )
}

/* ---------------- 编辑单节（内页） ---------------- */

export function EditSessionPage({
  occ, snap, onBack,
}: {
  occ: { ruleId?: string; courseId?: string; name: string; date: string; startPeriod: number; endPeriod: number; location?: string; teacher?: string; start: number; end: number }
  snap: Snapshot
  onBack: () => void
}) {
  const state = useStore()
  const rule = state.rules.find((r) => r.id === occ.ruleId)
  const ov = state.overrides.find((o) => o.ruleId === occ.ruleId && o.date === occ.date)
  const [scope, setScope] = useState(0) // 0 仅本次 1 每周
  const [date, setDate] = useState(ov?.newDate ?? occ.date)
  const [weekday, setWeekday] = useState<number>(rule?.weekday ?? 1)
  const [sp, setSp] = useState(ov?.newStartPeriod ?? occ.startPeriod)
  const [ep, setEp] = useState(ov?.newEndPeriod ?? occ.endPeriod)
  const [loc, setLoc] = useState(ov?.newLocation ?? occ.location ?? '')
  const teacher0 = rule?.teacher ?? occ.teacher ?? ''
  const [teacher, setTeacher] = useState(ov?.newTeacher ?? teacher0)
  const [note, setNote] = useState(ov?.note ?? '')
  const [status, setStatus] = useState<number>(() => {
    const i = STATUS.findIndex(([k]) => k === ov?.kind)
    return i > 0 ? i : 0
  })
  const sem = snap.semester

  const changed =
    date !== occ.date ||
    sp !== occ.startPeriod ||
    ep !== occ.endPeriod ||
    loc.trim() !== (occ.location ?? '') ||
    teacher.trim() !== teacher0
  const dirty =
    scope === 1
      ? weekday !== rule?.weekday || sp !== occ.startPeriod || ep !== occ.endPeriod || loc.trim() !== (occ.location ?? '') || teacher.trim() !== teacher0
      : changed || note.trim() !== (ov?.note ?? '') || STATUS[status][0] !== (ov?.kind === 'moved' ? undefined : ov?.kind)

  const save = () => {
    if (!occ.ruleId) return
    if (scope === 1) {
      store.editSessionRule(occ.ruleId, { weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7, startPeriod: sp, endPeriod: ep, location: loc.trim() || undefined, ...(teacher.trim() !== teacher0 ? { teacher: teacher.trim() || undefined } : {}) })
      onBack()
      return
    }
    const kind = STATUS[status][0]
    if (!kind) {
      if (changed) {
        store.addOverride({
          id: uid(), ruleId: occ.ruleId, date: occ.date, kind: 'moved',
          newDate: date, newStartPeriod: sp, newEndPeriod: ep,
          newLocation: loc.trim() || undefined, newTeacher: teacher.trim() !== teacher0 ? teacher.trim() : undefined, note: note.trim() || undefined,
          createdAt: Date.now(),
        })
      } else if (ov) {
        store.removeOverride(occ.ruleId, occ.date)
      }
    } else {
      store.addOverride({
        id: uid(), ruleId: occ.ruleId, date: occ.date, kind,
        note: note.trim() || undefined, createdAt: Date.now(),
      })
    }
    onBack()
  }

  return (
    <Page>
      <PageBody>
        <TopBar title="编辑课程" sub={`${occ.name}，${md(occ.date)} ${WD[new Date(`${occ.date}T00:00:00`).getDay() === 0 ? 7 : new Date(`${occ.date}T00:00:00`).getDay()]} ${occ.startPeriod}–${occ.endPeriod} 节`} onBack={onBack} />

        <div className="mt-5 text-[12.5px] font-semibold text-(--c-ink3)">生效范围</div>
        <div className="mt-2.5"><Chips items={['仅本次', '每周']} active={scope} onPick={setScope} /></div>

        {scope === 0 && (
          <>
            <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">状态</div>
            <div className="mt-2.5"><Chips items={STATUS.map(([, l]) => l)} active={status} onPick={setStatus} /></div>
          </>
        )}

        <div className="mt-4 text-[12.5px] font-semibold text-(--c-ink3)">时间与地点</div>
        <div className="mt-2.5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
          {scope === 0 ? (
            <Field k="日期"><DateInput value={date} onChange={setDate} /></Field>
          ) : (
            <Field k="星期">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                  <button key={w} onClick={() => setWeekday(w)} className={`flex-1 rounded-[9px] py-[5px] text-[12px] font-bold ${weekday === w ? 'bg-(--c-accent-soft) text-(--c-accent)' : 'text-(--c-ink3)'}`}>{WD_SHORT[w]}</button>
                ))}
              </div>
            </Field>
          )}
          <Field k="地点"><TextInput value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="可选" /></Field>
          <Field k="老师"><TextInput value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="可选" /></Field>
          <Field k="备注"><TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" /></Field>
        </div>

        <div className="mt-2.5">
          <PeriodPicker grid={sem.timeGrid} sp={sp} ep={ep} onPick={(a, b) => { setSp(a); setEp(b) }} />
        </div>

        {ov && (
          <div className="mt-5 overflow-hidden rounded-[16px] bg-(--c-surface)">
            <button
              onClick={() => { store.removeOverride(occ.ruleId!, occ.date); onBack() }}
              className="w-full px-4 py-3.5 text-left text-[13.5px] font-bold text-(--c-rose) transition-colors active:bg-(--c-bg)"
            >
              撤销本节改动
            </button>
          </div>
        )}
      </PageBody>

      <PageFooter>
        <PrimaryButton disabled={ep < sp || !dirty} onClick={save}>保存</PrimaryButton>
      </PageFooter>
    </Page>
  )
}

export { PageBody, TASK_LABEL, tint }
