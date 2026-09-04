import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Course, Task, TaskPhoto } from '../domain/types'
import { fmtMinutes, weekdayOf } from '../domain/dates'
import type { Snapshot } from '../domain/engine'
import { captureContext, suggestedDue, type ClassMoment } from '../domain/next-class'
import { uid } from '../domain/store'
import { store, useStore } from './store'
import { nowMinutes, todayStr } from './semester'
import { camera, nativeCamera, type CapturedPhoto, type GalleryItem } from './camera'
import { TaskPhotoImg } from './photo'
import {
  ArrowUpIcon, BottomVeil, CameraIcon, Chip, EmptyBlock, FADE, Page, PrimaryButton,
  QuickBar, SHEET, StickyHead, WD, md,
} from './ui'
import { hasNativePickers, nativePickDate, nativePickOption, nativePickTime } from './widgets'

const KINDS: Task['kind'][] = ['homework', 'exam', 'memo']
const KIND_LABEL: Record<Task['kind'], string> = { homework: '作业', exam: '考试', memo: '备忘' }

const dayDiff = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000)

/** 截止的口语说法：今晚 23:00 / 明天 09:00 / 周四 08:00 / 10月14日 */
function dueText(due: string | undefined, mins: number | undefined, today: string): string {
  if (!due) return '没有截止'
  const time = mins != null ? fmtMinutes(mins) : ''
  const diff = dayDiff(due, today)
  const tail = time ? ` ${time}` : ''
  if (diff === 0) return mins != null && mins >= 18 * 60 ? `今晚${tail}` : `今天${tail}`
  if (diff === 1) return `明天${tail}`
  if (diff > 1 && diff < 7) return `${WD[weekdayOf(due)]}${tail}`
  return `${md(due)}${tail}`
}

/** 第二行的时间感：已过截止、还剩 11 小时、3 天后 */
function leftText(t: Task, today: string, now: number): [string, 'rose' | 'ink'] | null {
  if (!t.due || t.done) return null
  const diff = dayDiff(t.due, today)
  if (diff < 0) return ['已过截止', 'rose']
  if (diff === 0) {
    if (t.dueMinutes == null) return ['今天到期', 'rose']
    const h = Math.round((t.dueMinutes - now) / 60)
    return h <= 0 ? ['已过截止', 'rose'] : [`还剩 ${h} 小时`, 'rose']
  }
  if (diff >= 3 && diff < 14) return [`${diff} 天后`, 'ink']
  return null
}

const timeOfDay = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* ---------------- 选择器：Android 走系统对话框，浏览器用原生控件 ---------------- */

function useHiddenPickers(onDate: (v: string) => void, onTime: (v: string) => void) {
  const dateRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const open = (ref: React.RefObject<HTMLInputElement | null>) => {
    const el = ref.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.click()
  }
  const node = (
    <>
      <input
        ref={dateRef}
        type="date"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(e) => e.target.value && onDate(e.target.value)}
      />
      <input
        ref={timeRef}
        type="time"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(e) => e.target.value && onTime(e.target.value)}
      />
    </>
  )
  return { node, openDate: () => open(dateRef), openTime: () => open(timeRef) }
}

async function chooseIndex(options: string[], selected: number, title: string): Promise<number | null> {
  if (hasNativePickers()) return nativePickOption(options, selected, title)
  return null
}

/* ---------------- 待办列表 ---------------- */

function Check({ done, color, onClick }: { done: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-[2px] flex-none">
      <span
        className="flex h-[17px] w-[17px] items-center justify-center rounded-[6px] border-[1.6px] transition-colors"
        style={{ borderColor: done ? color : 'var(--c-ink5)', background: done ? color : 'transparent' }}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-surface)' }} strokeWidth="3.6"><path d="m6 12.5 4 4 8-9" /></svg>
        )}
      </span>
    </button>
  )
}

export function TaskRow({
  t, course, today, now, onOpen, tone = 'surface',
}: {
  t: Task
  course?: Course
  today: string
  now: number
  onOpen: () => void
  tone?: 'surface' | 'surface2'
}) {
  const color = course?.color ?? 'var(--c-ink5)'
  const left = leftText(t, today, now)
  const photo = t.photos?.[0]
  const right = t.inbox && t.capturedAt ? `${timeOfDay(t.capturedAt)} 拍下` : dueText(t.due, t.dueMinutes, today)

  return (
    <div className={`flex items-start rounded-[14px] px-3.5 py-3 ${tone === 'surface' ? 'bg-(--c-surface)' : 'bg-(--c-surface2)'} ${t.done ? 'opacity-45' : ''}`}>
      <Check done={t.done} color={course?.color ?? 'var(--c-accent)'} onClick={() => store.editTask(t.id, { done: !t.done })} />
      <button onClick={onOpen} className="ml-3 min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-[14px] font-bold tracking-[-.01em] ${t.inbox ? 'text-(--c-ink3)' : 'text-(--c-ink)'} ${t.done ? 'line-through' : ''}`}>
            {t.title || '板书'}
          </span>
          {t.kind === 'exam' && (
            <span className="flex-none rounded-[5px] bg-(--c-rose-soft) px-1.5 py-[2px] text-[10px] font-extrabold text-(--c-rose)">考试</span>
          )}
        </div>
        <div className="mt-[5px] flex items-baseline gap-1.5 text-[12px] leading-[16px] font-medium text-(--c-ink4)">
          <span className="h-[7px] w-[7px] flex-none self-center rounded-full" style={{ background: color }} />
          <span className="truncate">{course?.name ?? KIND_LABEL[t.kind]}</span>
          <span className="ml-auto flex-none pl-2 tabular-nums text-(--c-ink3)">{right}</span>
        </div>
        {left && (
          <div className={`mt-1 text-[12px] font-semibold tabular-nums ${left[1] === 'rose' ? 'text-(--c-rose)' : 'text-(--c-ink3)'}`}>{left[0]}</div>
        )}
        {t.note && !left && <div className="mt-1 truncate text-[12px] font-medium text-(--c-ink3)">{t.note}</div>}
      </button>
      {photo && <TaskPhotoImg path={photo.path} className="ml-3 h-[56px] w-[56px] flex-none rounded-[10px]" />}
    </div>
  )
}

/** 待整理的一条：底部多一个「下次课前」的一键建议 */
function InboxRow({
  t, course, snap, today, onOpen,
}: {
  t: Task
  course?: Course
  snap: Snapshot | null
  today: string
  onOpen: () => void
}) {
  const suggest = snap ? suggestedDue(snap, t.courseId, today, nowMinutes()) : null
  const photo = t.photos?.[0]
  return (
    <div className="flex items-start rounded-[14px] bg-(--c-surface) px-3.5 py-3">
      <Check done={t.done} color={course?.color ?? 'var(--c-accent)'} onClick={() => store.editTask(t.id, { done: !t.done })} />
      <div className="ml-3 min-w-0 flex-1">
        <button onClick={onOpen} className="block w-full text-left">
          <div className="truncate text-[14px] font-bold tracking-[-.01em] text-(--c-ink3)">{t.title || '板书'}</div>
          <div className="mt-[5px] flex items-baseline gap-1.5 text-[12px] leading-[16px] font-medium text-(--c-ink4)">
            <span className="h-[7px] w-[7px] flex-none self-center rounded-full" style={{ background: course?.color ?? 'var(--c-ink5)' }} />
            <span className="truncate">{course?.name ?? KIND_LABEL[t.kind]}</span>
            <span className="ml-auto flex-none pl-2 tabular-nums text-(--c-ink3)">
              {t.capturedAt ? `${timeOfDay(t.capturedAt)} 拍下` : dueText(t.due, t.dueMinutes, today)}
            </span>
          </div>
        </button>
        {suggest && suggest.beforeClass && (
          <button
            onClick={() => store.editTask(t.id, { due: suggest.due, dueMinutes: suggest.dueMinutes, inbox: false })}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-(--c-accent-soft) px-2.5 py-[5px] text-[11.5px] font-bold text-(--c-accent) transition-transform duration-150 active:scale-[.96]"
          >
            下次课前，{WD[weekdayOf(suggest.due)]} {fmtMinutes(suggest.dueMinutes)}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        )}
      </div>
      {photo && <TaskPhotoImg path={photo.path} className="ml-3 h-[56px] w-[56px] flex-none rounded-[10px]" />}
    </div>
  )
}

export function TodoView({
  snap, onOpen, onCamera, onText,
}: {
  snap: Snapshot | null
  onOpen: (t: Task) => void
  onCamera: () => void
  onText: () => void
}) {
  const state = useStore()
  const today = todayStr()
  const now = nowMinutes()
  const [showDone, setShowDone] = useState(false)
  const courseOf = (t: Task) => state.courses.find((c) => c.id === t.courseId)

  const open = state.tasks.filter((t) => !t.done)
  const inbox = open.filter((t) => t.inbox)
  const rest = open.filter((t) => !t.inbox)
  const weekEnd = useMemo(() => {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }, [today])

  const done = state.tasks.filter((t) => t.done)
  const groups: [string, Task[]][] = [
    ['今天', rest.filter((t) => t.due && t.due <= today)],
    ['这周', rest.filter((t) => t.due && t.due > today && t.due <= weekEnd)],
    ['以后', rest.filter((t) => t.due && t.due > weekEnd)],
    ['没有截止', rest.filter((t) => !t.due)],
  ]

  return (
    <>
      <div className="flex-1 overflow-y-auto pb-[170px] [scrollbar-width:none]">
        <StickyHead className="px-5">
          <h1 className="text-[26px] font-extrabold tracking-[-.02em] text-(--c-ink)">待办</h1>
          {state.tasks.length > 0 && (
            <div className="mt-2 flex items-center gap-2.5 text-[12.5px] font-semibold text-(--c-ink3)">
              <span>今天 {groups[0][1].length} 项</span>
              <span className="h-3 w-px bg-(--c-line)" />
              <span>这周 {groups[1][1].length} 项</span>
              {inbox.length > 0 && (
                <>
                  <span className="h-3 w-px bg-(--c-line)" />
                  <span className="text-(--c-ink4)">{inbox.length} 项待整理</span>
                </>
              )}
            </div>
          )}
        </StickyHead>

        {state.tasks.length === 0 ? (
          <div className="mt-14">
            <EmptyBlock
              kind="todo"
              title="暂无待办"
              desc="作业、考试与日常备忘。在这里随手记下，件件有着落。"
              actions={[['拍板书', onCamera, <CameraIcon key="c" size={15} stroke="#fff" />], ['文字', onText]]}
            />
          </div>
        ) : (
          <div className="mt-6 px-5">
            {inbox.length > 0 && (
              <div className="mb-5">
                <div className="flex items-baseline justify-between px-0.5">
                  <span className="text-[13px] font-extrabold tracking-[-.01em] text-(--c-ink)">待整理</span>
                  <span className="text-[11.5px] font-semibold tabular-nums text-(--c-ink4)">{inbox.length} 项</span>
                </div>
                <div className="mt-2.5 space-y-2">
                  {inbox.map((t) => (
                    <InboxRow key={t.id} t={t} course={courseOf(t)} snap={snap} today={today} onOpen={() => onOpen(t)} />
                  ))}
                </div>
              </div>
            )}
            {groups.filter(([, l]) => l.length > 0).map(([g, list]) => (
              <div key={g} className="mb-5">
                <div className="flex items-baseline justify-between px-0.5">
                  <span className="text-[13px] font-extrabold tracking-[-.01em] text-(--c-ink)">{g}</span>
                  <span className="text-[11.5px] font-semibold tabular-nums text-(--c-ink4)">{list.length} 项</span>
                </div>
                <div className="mt-2.5 space-y-2">
                  {list.map((t) => (
                    <TaskRow key={t.id} t={t} course={courseOf(t)} today={today} now={now} onOpen={() => onOpen(t)} />
                  ))}
                </div>
              </div>
            ))}
            {done.length > 0 && (
              <>
                <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between px-0.5 py-1">
                  <span className="text-[13px] font-extrabold tracking-[-.01em] text-(--c-ink4)">已完成 {done.length} 项</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.4" className={showDone ? 'rotate-90' : ''}><path d="m9 5 7 7-7 7" /></svg>
                </button>
                {showDone && (
                  <div className="mt-2.5 space-y-2">
                    {done.map((t) => (
                      <TaskRow key={t.id} t={t} course={courseOf(t)} today={today} now={now} onOpen={() => onOpen(t)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <BottomVeil height={190} />
      {state.tasks.length > 0 && <QuickBar onCamera={onCamera} onText={onText} />}
    </>
  )
}

/* ---------------- 文字：胶囊展开成一段话 ---------------- */

export function ComposeOverlay({
  snap, courseId, onClose, onCamera,
}: {
  snap: Snapshot | null
  courseId?: string
  onClose: () => void
  onCamera: () => void
}) {
  const state = useStore()
  const today = todayStr()
  const now = nowMinutes()
  const ctx = useMemo(() => (snap ? captureContext(snap, today, now) : null), [snap, today, now])
  const [text, setText] = useState('')
  const [cid, setCid] = useState(courseId ?? ctx?.courseId ?? '')
  const guess = useMemo(() => (snap ? suggestedDue(snap, cid || undefined, today, now) : null), [snap, cid, today, now])
  const [due, setDue] = useState(guess?.due ?? '')
  const [dueMinutes, setDueMinutes] = useState<number | undefined>(guess?.dueMinutes)
  const ref = useRef<HTMLTextAreaElement>(null)
  const course = state.courses.find((c) => c.id === cid)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const pickers = useHiddenPickers(
    (v) => setDue(v),
    (v) => {
      const [h, m] = v.split(':').map(Number)
      setDueMinutes(h * 60 + (m || 0))
    },
  )

  const pickCourse = async () => {
    const courses = state.courses.filter((c) => !c.removedByImport)
    const labels = ['不关联', ...courses.map((c) => c.name)]
    const i = await chooseIndex(labels, courses.findIndex((c) => c.id === cid) + 1, '课程')
    if (i == null) return
    setCid(i === 0 ? '' : courses[i - 1].id)
  }

  const send = () => {
    const title = text.trim()
    if (!title) return
    store.addTask({
      id: uid(),
      title,
      kind: 'homework',
      courseId: cid || undefined,
      due: due || undefined,
      dueMinutes,
      done: false,
      createdAt: Date.now(),
      photos: [],
      capturedCourseId: ctx?.courseId,
      capturedAt: Date.now(),
    })
    onClose()
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} className="absolute inset-0 z-[38]">
      <button onClick={onClose} className="absolute inset-0 bg-(--c-bg)/55" />
      <motion.div
        initial={{ transform: 'translateY(16px)' }}
        animate={{ transform: 'translateY(0px)' }}
        exit={{ transform: 'translateY(16px)' }}
        transition={SHEET}
        className="absolute inset-x-3 bottom-3 will-change-transform"
      >
        <div className="rounded-[26px] px-4 pt-3.5 pb-3" style={{ background: 'var(--c-dock)', border: '1px solid var(--c-dock-line)', boxShadow: 'var(--c-dock-shadow)' }}>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="新待办"
            className="max-h-[120px] w-full resize-none bg-transparent text-[16px] leading-[1.4] font-semibold tracking-[-.01em] text-(--c-ink) outline-none placeholder:font-medium placeholder:text-(--c-ink4)"
          />
          <div className="mt-3 flex items-center gap-1.5">
            <button
              onClick={onCamera}
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-(--c-surface2) transition-transform duration-150 active:scale-[.92]"
            >
              <CameraIcon size={16} stroke="var(--c-ink2)" />
            </button>
            <Chip color={course?.color} onClick={() => void pickCourse()}>{course?.name ?? '课程'}</Chip>
            <Chip onClick={hasNativePickers() ? () => void nativePickDate(due || today).then((v) => v && setDue(v)) : pickers.openDate}>
              {due ? dueText(due, dueMinutes, today) : '截止'}
            </Chip>
            <span className="flex-1" />
            <button
              onClick={send}
              disabled={!text.trim()}
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-(--c-accent) transition-transform duration-150 active:scale-[.92] disabled:bg-(--c-line)"
            >
              <ArrowUpIcon />
            </button>
          </div>
          {pickers.node}
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ---------------- 相机 ---------------- */

const CircleBtn = ({ children, onClick, size = 36 }: { children: React.ReactNode; onClick?: () => void; size?: number }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center rounded-full bg-white/12 transition-transform duration-150 active:scale-[.92]"
    style={{ height: size, width: size }}
  >
    {children}
  </button>
)

export function CameraPage({
  snap, courseId, onBack, onPicker, onShot,
}: {
  snap: Snapshot | null
  courseId?: string
  onBack: () => void
  onPicker: () => void
  onShot: (photos: CapturedPhoto[], cid?: string) => void
}) {
  const state = useStore()
  const today = todayStr()
  const now = nowMinutes()
  const ctx = useMemo(() => (snap ? captureContext(snap, today, now) : null), [snap, today, now])
  const [cid, setCid] = useState(courseId ?? ctx?.courseId ?? '')
  const [denied, setDenied] = useState(false)
  const [torch, setTorch] = useState(false)
  const [thumb, setThumb] = useState<GalleryItem | null>(null)
  const [busy, setBusy] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLDivElement>(null)
  const course = state.courses.find((c) => c.id === cid)

  const startPreview = async () => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    await camera.start('back', { x: box.left, y: box.top, width: box.width, height: box.height })
    const el = camera.webPreview()
    if (el && video.current) {
      el.className = 'h-full w-full object-cover'
      video.current.replaceChildren(el)
    }
  }

  useEffect(() => {
    let alive = true
    if (nativeCamera()) document.documentElement.dataset.camera = '1'
    void (async () => {
      const status = await camera.request('camera')
      if (!alive) return
      if (status !== 'granted') {
        setDenied(true)
        return
      }
      try {
        await startPreview()
      } catch {
        setDenied(true)
      }
      const items = await camera.listRecent(0, 1)
      if (alive) setThumb(items[0] ?? null)
    })()
    return () => {
      alive = false
      delete document.documentElement.dataset.camera
      void camera.stop()
    }
  }, [])

  const shoot = async () => {
    if (busy) return
    setBusy(true)
    try {
      const photo = await camera.capture()
      onShot([photo], cid || undefined)
    } catch {
      setBusy(false)
    }
  }

  const pickCourse = async () => {
    const courses = state.courses.filter((c) => !c.removedByImport)
    const labels = ['不关联', ...courses.map((c) => c.name)]
    const i = await chooseIndex(labels, courses.findIndex((c) => c.id === cid) + 1, '课程')
    if (i == null) return
    setCid(i === 0 ? '' : courses[i - 1].id)
  }

  return (
    <Page className="bg-transparent">
      <div data-camera-page className="absolute inset-0 flex flex-col">
        <div className="flex flex-none items-center justify-between bg-black px-4 pt-12 pb-4">
          <CircleBtn onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </CircleBtn>
          <button
            onClick={() => void pickCourse()}
            className="flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[12.5px] font-bold text-white transition-transform duration-150 active:scale-[.96]"
          >
            {course && <span className="h-[7px] w-[7px] rounded-full" style={{ background: course.color }} />}
            {course?.name ?? '课程'}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="3"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <CircleBtn onClick={() => { setTorch((v) => !v); void camera.torch(!torch) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={torch ? '#fff' : 'none'} stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
          </CircleBtn>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={frame} className="absolute inset-y-0 inset-x-2 rounded-[24px]">
            <div ref={video} className="absolute inset-0 overflow-hidden rounded-[24px] [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[24px]" style={{ boxShadow: '0 0 0 200vmax #000' }} />
            <div className="pointer-events-none absolute inset-0 rounded-[24px]" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.25), transparent 30%, transparent 75%, rgba(0,0,0,.35))' }} />
            {['left-5 top-5 border-l-2 border-t-2 rounded-tl-[8px]', 'right-5 top-5 border-r-2 border-t-2 rounded-tr-[8px]', 'left-5 bottom-5 border-l-2 border-b-2 rounded-bl-[8px]', 'right-5 bottom-5 border-r-2 border-b-2 rounded-br-[8px]'].map((c) => (
              <span key={c} className={`pointer-events-none absolute h-6 w-6 border-white/80 ${c}`} />
            ))}
            {denied && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-[24px] bg-black px-8 text-center">
                <div className="text-[15px] font-bold text-white">相机未开启</div>
                <div className="mt-2 text-[12.5px] font-medium text-white/60">在系统设置里允许相机，即可拍下板书</div>
                <button
                  onClick={() => void camera.request('camera').then((s) => { if (s === 'granted') { setDenied(false); void startPreview() } })}
                  className="mt-4 flex h-[34px] items-center rounded-full bg-white px-4 text-[13px] font-bold text-black"
                >
                  重试
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center justify-between bg-black px-9 pt-6 pb-10">
          <button onClick={onPicker} className="h-[46px] w-[46px] overflow-hidden rounded-[12px] ring-2 ring-white/25 transition-transform duration-150 active:scale-[.94]">
            {thumb ? (
              <img src={thumb.thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-white/12">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 16 5-4 4 3 3-2 6 4" /></svg>
              </span>
            )}
          </button>
          <button
            onClick={() => void shoot()}
            className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-[3.5px] border-white transition-transform duration-150 active:scale-[.94]"
          >
            <span className="h-[62px] w-[62px] rounded-full bg-white" />
          </button>
          <CircleBtn size={46} onClick={() => void camera.switchCamera()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" /><path d="M4 20v-5h5M20 4v5h-5" /></svg>
          </CircleBtn>
        </div>
      </div>
    </Page>
  )
}

/* ---------------- 相册 ---------------- */

export function PickerPage({ onBack, onDone }: { onBack: () => void; onDone: (photos: CapturedPhoto[]) => void }) {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const status = await camera.request('photos')
      if (!alive || status !== 'granted') return
      const list = await camera.listRecent(0)
      if (alive) {
        setItems(list)
        setMore(list.length > 0)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadMore = async () => {
    if (!more) return
    const next = page + 1
    const list = await camera.listRecent(next)
    setPage(next)
    setItems((cur) => [...cur, ...list])
    if (list.length === 0) setMore(false)
  }

  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      onDone(await camera.importPicked(picked))
    } catch {
      setBusy(false)
    }
  }

  return (
    <Page className="bg-black">
      <div className="flex flex-none items-center justify-between px-4 pt-12">
        <CircleBtn onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </CircleBtn>
        <span className="flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[12.5px] font-bold text-white">最近项目</span>
        <span className="w-9" />
      </div>

      <div
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) void loadMore()
        }}
        className="mt-4 min-h-0 flex-1 overflow-y-auto px-[3px] [scrollbar-width:none]"
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="text-[15px] font-bold text-white">没有可选的照片</div>
            <div className="mt-2 text-[12.5px] font-medium text-white/60">允许访问照片，或直接从文件里选择</div>
            <button
              onClick={() => void camera.pick().then((ps) => ps.length > 0 && onDone(ps))}
              className="mt-4 flex h-[34px] items-center rounded-full bg-white px-4 text-[13px] font-bold text-black"
            >
              从文件选择
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 content-start gap-[3px]">
            {items.map((it) => {
              const n = picked.indexOf(it.id)
              return (
                <button
                  key={it.id}
                  onClick={() => setPicked((cur) => (n >= 0 ? cur.filter((x) => x !== it.id) : [...cur, it.id]))}
                  className="relative aspect-square overflow-hidden rounded-[6px]"
                >
                  <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {n >= 0 ? (
                    <>
                      <span className="absolute inset-0 rounded-[6px] ring-[2.5px] ring-inset ring-(--c-accent)" style={{ background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)' }} />
                      <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-(--c-accent) text-[11px] font-extrabold text-white">{n + 1}</span>
                    </>
                  ) : (
                    <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full border-[1.5px] border-white/80" style={{ background: 'rgba(0,0,0,.25)' }} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-none px-5 pt-3 pb-8">
        <PrimaryButton onDark disabled={picked.length === 0} onClick={() => void add()}>添加 {picked.length} 张</PrimaryButton>
      </div>
    </Page>
  )
}

/* ---------------- 胶囊组：课程、截止、分类 ---------------- */

function MetaChips({
  cid, due, dueMinutes, kind, today, onCourse, onDue, onTime, onKind,
}: {
  cid: string
  due?: string
  dueMinutes?: number
  kind: Task['kind']
  today: string
  onCourse: () => void
  onDue: () => void
  onTime: () => void
  onKind: () => void
}) {
  const state = useStore()
  const course = state.courses.find((c) => c.id === cid)
  return (
    <div className="flex flex-wrap gap-2">
      <Chip color={course?.color} onClick={onCourse}>{course?.name ?? '课程'}</Chip>
      <Chip onClick={onDue}>{due ? dueText(due, dueMinutes, today) : '截止'}</Chip>
      {due && <Chip onClick={onTime}>{dueMinutes != null ? fmtMinutes(dueMinutes) : '时间'}</Chip>}
      <Chip onClick={onKind}>{KIND_LABEL[kind]}</Chip>
    </div>
  )
}

/** 课程、截止、分类的选择逻辑：三个页面共用 */
function useMeta(initial: { cid: string; due?: string; dueMinutes?: number; kind: Task['kind'] }, courses: Course[]) {
  const [cid, setCid] = useState(initial.cid)
  const [due, setDue] = useState(initial.due ?? '')
  const [dueMinutes, setDueMinutes] = useState<number | undefined>(initial.dueMinutes)
  const [kind, setKind] = useState<Task['kind']>(initial.kind)
  const pickers = useHiddenPickers(setDue, (v) => {
    const [h, m] = v.split(':').map(Number)
    setDueMinutes(h * 60 + (m || 0))
  })
  const list = courses.filter((c) => !c.removedByImport)

  const pickCourse = async () => {
    const labels = ['不关联', ...list.map((c) => c.name)]
    const i = await chooseIndex(labels, list.findIndex((c) => c.id === cid) + 1, '课程')
    if (i == null) return
    setCid(i === 0 ? '' : list[i - 1].id)
  }
  const pickKind = async () => {
    const i = await chooseIndex(KINDS.map((k) => KIND_LABEL[k]), KINDS.indexOf(kind), '分类')
    if (i == null) {
      setKind(KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length])
      return
    }
    setKind(KINDS[i])
  }
  const pickDue = () => {
    if (hasNativePickers()) void nativePickDate(due || todayStr()).then((v) => v && setDue(v))
    else pickers.openDate()
  }
  const pickTime = () => {
    if (hasNativePickers()) {
      void nativePickTime(dueMinutes != null ? fmtMinutes(dueMinutes) : '23:00').then((v) => {
        if (!v) return
        const [h, m] = v.split(':').map(Number)
        setDueMinutes(h * 60 + (m || 0))
      })
    } else pickers.openTime()
  }
  return { cid, setCid, due, setDue, dueMinutes, kind, pickCourse, pickKind, pickDue, pickTime, node: pickers.node }
}

/* ---------------- 拍完：一下保存 ---------------- */

export function ReviewPage({
  snap, photos, courseId, onBack, onRetake, onSaved,
}: {
  snap: Snapshot | null
  photos: CapturedPhoto[]
  courseId?: string
  onBack: () => void
  onRetake: () => void
  onSaved: () => void
}) {
  const state = useStore()
  const today = todayStr()
  const now = nowMinutes()
  const ctx = useMemo(() => (snap ? captureContext(snap, today, now) : null), [snap, today, now])
  const cid0 = courseId ?? ctx?.courseId ?? ''
  const guess = useMemo(() => (snap ? suggestedDue(snap, cid0 || undefined, today, now) : null), [snap, cid0, today, now])
  const meta = useMeta({ cid: cid0, due: guess?.due, dueMinutes: guess?.dueMinutes, kind: 'homework' }, state.courses)
  const [title, setTitle] = useState('')
  const capturedCourse = state.courses.find((c) => c.id === ctx?.courseId)

  const save = () => {
    const name = title.trim()
    store.addTask({
      id: uid(),
      title: name,
      kind: meta.kind,
      courseId: meta.cid || undefined,
      due: meta.due || undefined,
      dueMinutes: meta.dueMinutes,
      done: false,
      createdAt: Date.now(),
      photos: photos.map((p) => ({ id: uid(), path: p.path, w: p.width, h: p.height, takenAt: Date.now() })),
      inbox: name.length === 0,
      capturedCourseId: ctx?.courseId,
      capturedAt: Date.now(),
    })
    onSaved()
  }

  return (
    <Page>
      <div className="flex flex-1 flex-col overflow-hidden px-5 pt-12">
        <div className="flex flex-none items-center justify-between">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
          </button>
          <button onClick={onRetake} className="flex h-9 items-center rounded-full bg-(--c-surface) px-4 text-[13px] font-bold text-(--c-ink) transition-transform duration-150 active:scale-[.96]">重拍</button>
        </div>

        <div className="mt-4 flex flex-none gap-2.5 overflow-x-auto [scrollbar-width:none]">
          {photos.map((p, i) => (
            <TaskPhotoImg
              key={p.path}
              path={p.path}
              className={`h-[250px] flex-none overflow-hidden rounded-[20px] ${photos.length === 1 ? 'w-full' : 'w-[70%]'} ${i === 0 ? '' : ''}`}
            />
          ))}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="名称"
          className="mt-5 w-full flex-none bg-transparent text-[17px] font-semibold text-(--c-ink) outline-none placeholder:text-(--c-ink5)"
        />

        <div className="mt-4 flex-none">
          <MetaChips
            cid={meta.cid}
            due={meta.due}
            dueMinutes={meta.dueMinutes}
            kind={meta.kind}
            today={today}
            onCourse={() => void meta.pickCourse()}
            onDue={meta.pickDue}
            onTime={meta.pickTime}
            onKind={() => void meta.pickKind()}
          />
        </div>

        <div className="flex-1" />
        {meta.node}
      </div>
      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton onClick={save}>保存</PrimaryButton>
      </div>
    </Page>
  )
}

/* ---------------- 详情 ---------------- */

export function TaskDetailPage({
  task, snap, onBack, onCamera,
}: {
  task: Task
  snap: Snapshot | null
  onBack: () => void
  onCamera: () => void
}) {
  const state = useStore()
  const cur = state.tasks.find((t) => t.id === task.id) ?? task
  const today = todayStr()
  const meta = useMeta({ cid: cur.courseId ?? '', due: cur.due, dueMinutes: cur.dueMinutes, kind: cur.kind }, state.courses)
  const [title, setTitle] = useState(cur.title)
  const [note, setNote] = useState(cur.note ?? '')
  const capturedCourse = state.courses.find((c) => c.id === cur.capturedCourseId)

  /* 改动即时落库，退出时不需要「保存」 */
  useEffect(() => {
    store.editTask(cur.id, {
      title,
      note: note.trim() || undefined,
      courseId: meta.cid || undefined,
      due: meta.due || undefined,
      dueMinutes: meta.dueMinutes,
      kind: meta.kind,
      inbox: title.trim().length === 0 ? cur.inbox : false,
    })
  }, [title, note, meta.cid, meta.due, meta.dueMinutes, meta.kind])

  const removeTask = async () => {
    const i = await chooseIndex(['删除'], -1, cur.title || '待办')
    if (i !== 0) return
    await camera.remove((cur.photos ?? []).map((p) => p.path))
    store.removeTask(cur.id)
    onBack()
  }

  return (
    <Page>
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-12 [scrollbar-width:none]">
        <div className="flex flex-none items-center justify-between">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.4"><path d="M15 19 8 12l7-7" /></svg>
          </button>
          <button onClick={() => void removeTask()} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
            <svg width="16" height="16" viewBox="0 0 24 24" style={{ fill: 'var(--c-ink)' }}><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </div>

        <textarea
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="名称"
          className="mt-5 w-full resize-none bg-transparent text-[22px] leading-[1.3] font-extrabold tracking-[-.02em] text-(--c-ink) outline-none placeholder:text-(--c-ink5)"
        />

        <div className="mt-4 flex gap-2.5 overflow-x-auto [scrollbar-width:none]">
          {(cur.photos ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => void (async () => {
                const i = await chooseIndex(['删除这张'], -1, '照片')
                if (i !== 0) return
                await camera.remove([p.path])
                store.removePhoto(cur.id, p.id)
              })()}
              className="h-[76px] w-[102px] flex-none overflow-hidden rounded-[12px]"
            >
              <TaskPhotoImg path={p.path} className="h-full w-full" />
            </button>
          ))}
          <button
            onClick={onCamera}
            className="flex h-[76px] w-[76px] flex-none items-center justify-center rounded-[12px] border-[1.5px] border-dashed border-(--c-ink5) transition-transform duration-150 active:scale-[.94]"
          >
            <CameraIcon stroke="var(--c-ink4)" />
          </button>
        </div>

        <div className="mt-4">
          <MetaChips
            cid={meta.cid}
            due={meta.due}
            dueMinutes={meta.dueMinutes}
            kind={meta.kind}
            today={today}
            onCourse={() => void meta.pickCourse()}
            onDue={meta.pickDue}
            onTime={meta.pickTime}
            onKind={() => void meta.pickKind()}
          />
        </div>

        <div className="mt-4 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
          <textarea
            rows={1}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注"
            className="w-full resize-none bg-transparent text-[14px] leading-[1.5] font-medium text-(--c-ink) outline-none placeholder:text-(--c-ink4)"
          />
        </div>


        <div className="pb-6" />
        {meta.node}
      </div>
      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton onClick={() => { store.editTask(cur.id, { done: !cur.done }); onBack() }}>
          {cur.done ? '标记未完成' : '完成'}
        </PrimaryButton>
      </div>
    </Page>
  )
}

/* ---------------- 今天页：刚下课那一刻 ---------------- */

export function ClassEndCard({ moment, onCamera, onText, onDismiss }: {
  moment: ClassMoment
  onCamera: () => void
  onText: () => void
  onDismiss: () => void
}) {
  return (
    <div className="-mt-4 flex">
      <div className="w-11 flex-none" />
      <div className="ml-3 w-[2px] flex-none self-stretch bg-(--c-accent)" />
      <div className="flex-1 pb-7 pl-4">
        <div className="rounded-[16px] bg-(--c-surface) p-3.5">
          <div className="flex items-start justify-between">
            <div className="text-[14px] font-bold tracking-[-.01em] text-(--c-ink)">刚下课，这节课有作业吗？</div>
            <button onClick={onDismiss} className="ml-2 flex-none pt-[3px]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button onClick={onCamera} className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-full bg-(--c-ink) text-[12.5px] font-bold text-(--c-bg) transition-transform duration-150 active:scale-[.96]">
              <CameraIcon size={15} stroke="var(--c-bg)" />
              拍板书
            </button>
            <button onClick={onText} className="flex h-[34px] flex-1 items-center justify-center rounded-full bg-(--c-surface2) text-[12.5px] font-bold text-(--c-ink) transition-transform duration-150 active:scale-[.96]">
              文字
            </button>
          </div>
          <div className="mt-2.5 text-[11.5px] font-medium text-(--c-ink4)">{moment.name}</div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 课程内页：作业与备忘 ---------------- */

export function CourseTasks({
  tasks, course, onOpen, onCamera, onText,
}: {
  tasks: Task[]
  course: Course
  onOpen: (t: Task) => void
  onCamera: () => void
  onText: () => void
}) {
  const today = todayStr()
  const now = nowMinutes()
  return (
    <>
      <div className="text-[14px] font-bold text-(--c-ink)">作业与备忘</div>
      {tasks.length === 0 ? (
        <div className="mt-3 text-[12.5px] font-medium text-(--c-ink4)">还没有作业或备忘</div>
      ) : (
        <div className="mt-3 space-y-2">
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} course={course} today={today} now={now} onOpen={() => onOpen(t)} tone="surface2" />
          ))}
        </div>
      )}
      <div className="mt-3.5 flex items-center gap-2 rounded-full bg-(--c-surface2) p-[6px] pr-3.5">
        <button
          onClick={onCamera}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]"
        >
          <CameraIcon size={17} />
        </button>
        <button onClick={onText} className="flex-1 pl-1 text-left text-[14px] font-medium text-(--c-ink4)">新待办</button>
      </div>
    </>
  )
}
