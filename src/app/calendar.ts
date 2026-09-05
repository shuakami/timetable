import { useSyncExternalStore } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { EXAM_CALENDAR, TASK_CALENDAR, WEEK_CALENDAR, calendarsFor, eventHash, planCalendar, summarize, type CalendarEventBody, type CalendarSpec, type CalendarSummary, type DesiredEvent } from '../domain/calendar-plan'
import { store } from './store'

/* 系统日历：课、作业、考试各写进应用自己的一本本地日历，提醒由系统日历发出。
   这里只做两件事：把 Store 投影成期望事件集合，和日历里现有的比出差异后一次写入。
   映射关系（key / hash）就存在日历事件上，没有第二份状态。 */

export type CalendarPermission = 'granted' | 'prompt' | 'denied' | 'unsupported'

interface RemoteEvent {
  id: number
  calendarId: number
  key: string
  hash: string
}

interface WriteItem {
  calendarId: number
  key: string
  hash: string
  event: CalendarEventBody
  reminders: number[]
}

interface TtCalendarPlugin {
  checkPermission(): Promise<{ status: CalendarPermission }>
  requestPermission(): Promise<{ status: CalendarPermission }>
  ensureCalendars(o: { calendars: (CalendarSpec & { color: string })[] }): Promise<{ ids: Record<string, number> }>
  readAll(): Promise<{ events: RemoteEvent[] }>
  apply(o: { inserts: WriteItem[]; updates: (WriteItem & { id: number })[]; deletes: number[] }): Promise<{ inserted: number; updated: number; deleted: number }>
  hasCalendarApp(): Promise<{ available: boolean }>
  openCalendar(o: { at: number }): Promise<void>
  openAppSettings(): Promise<void>
}

const TtCalendar = registerPlugin<TtCalendarPlugin>('TtCalendar')

const DEBOUNCE_MS = 800
const CHUNK = 50

export const calendarSupported = () => Capacitor.getPlatform() === 'android'

/* ---------------- 状态（给设置页） ---------------- */

export interface CalendarStatus {
  permission: CalendarPermission
  syncing: boolean
  /** 最近一次成功写入后日历里的内容 */
  summary: CalendarSummary | null
  lastSyncAt: number | null
  failed: boolean
}

let status: CalendarStatus = { permission: calendarSupported() ? 'prompt' : 'unsupported', syncing: false, summary: null, lastSyncAt: null, failed: false }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<CalendarStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

export function useCalendarStatus(): CalendarStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    () => status,
  )
}

/* ---------------- 权限 ---------------- */

export async function calendarPermission(): Promise<CalendarPermission> {
  if (!calendarSupported()) return 'unsupported'
  try {
    const { status: s } = await TtCalendar.checkPermission()
    setStatus({ permission: s })
    return s
  } catch {
    return 'denied'
  }
}

/** 弹系统权限框；拿到后立刻把课表写进去 */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  if (!calendarSupported()) return 'unsupported'
  try {
    const { status: s } = await TtCalendar.requestPermission()
    setStatus({ permission: s })
    if (s === 'granted') await syncCalendar()
    return s
  } catch {
    setStatus({ permission: 'denied' })
    return 'denied'
  }
}

/* ---------------- 同步 ---------------- */

function cssColor(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (/^#[0-9a-f]{6}$/i.test(v)) return v
  } catch {
    /* 非浏览器环境 */
  }
  return fallback
}

/** 每门课一本（课程颜色），作业 / 考试 / 周次各一本，颜色跟应用里一致 */
function withColors(specs: CalendarSpec[]): (CalendarSpec & { color: string })[] {
  const fixed: Record<string, string> = {
    [TASK_CALENDAR]: cssColor('--c-amber', '#B98A2F'),
    [EXAM_CALENDAR]: cssColor('--c-rose', '#DE5B78'),
    [WEEK_CALENDAR]: cssColor('--c-ink4', '#8A8E97'),
  }
  const accent = cssColor('--c-accent', '#4F5BD5')
  return specs.map((c) => ({ ...c, color: c.color ?? fixed[c.slug] ?? accent }))
}

function toWrite(e: DesiredEvent, ids: Record<string, number>): WriteItem {
  return { calendarId: ids[e.calendar], key: e.key, hash: eventHash(e), event: e.event, reminders: e.reminders }
}

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

let running: Promise<void> | null = null
let again = false

async function doSync(): Promise<void> {
  const perm = await calendarPermission()
  if (perm !== 'granted') return
  setStatus({ syncing: true })
  try {
    const snap = store.snapshot()
    const desired = planCalendar(snap, store.state.tasks, store.state.prefs, new Date())
    const { ids } = await TtCalendar.ensureCalendars({ calendars: withColors(calendarsFor(desired, snap)) })
    const { events: remote } = await TtCalendar.readAll()

    const byKey = new Map<string, RemoteEvent>()
    const deletes: number[] = []
    for (const r of remote) {
      // 同一个 key 出现两次（异常情况）：留一条，其余删掉
      if (!r.key || byKey.has(r.key)) deletes.push(r.id)
      else byKey.set(r.key, r)
    }
    const inserts: WriteItem[] = []
    const updates: (WriteItem & { id: number })[] = []
    for (const e of desired) {
      const w = toWrite(e, ids)
      const r = byKey.get(e.key)
      if (!r) inserts.push(w)
      else {
        byKey.delete(e.key)
        // 换了本日历（作业改成考试）就删掉重建，其余内容变了原地改
        if (r.calendarId !== w.calendarId) {
          deletes.push(r.id)
          inserts.push(w)
        } else if (r.hash !== w.hash) updates.push({ ...w, id: r.id })
      }
    }
    for (const r of byKey.values()) deletes.push(r.id)

    if (inserts.length + updates.length + deletes.length > 0) {
      try {
        await TtCalendar.apply({ inserts, updates, deletes })
      } catch {
        // 整批失败就拆小批重试，让一条坏数据只影响它自己
        for (const d of chunks(deletes, CHUNK)) await TtCalendar.apply({ inserts: [], updates: [], deletes: d }).catch(() => undefined)
        for (const u of chunks(updates, CHUNK)) await TtCalendar.apply({ inserts: [], updates: u, deletes: [] }).catch(() => undefined)
        for (const i of chunks(inserts, CHUNK)) await TtCalendar.apply({ inserts: i, updates: [], deletes: [] }).catch(() => undefined)
      }
    }
    setStatus({ summary: summarize(desired), lastSyncAt: Date.now(), failed: false })
  } catch {
    setStatus({ failed: true })
  } finally {
    setStatus({ syncing: false })
  }
}

/** 把 Store 里的当前状态写进系统日历；并发调用合并成一次，进行中再来一次就排队 */
export function syncCalendar(): Promise<void> {
  if (!calendarSupported()) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await doSync()
    } while (again)
  })().finally(() => { running = null })
  return running
}

let timer: number | null = null

/** Store 变化后延迟一小会再写，连续编辑只写一次 */
export function scheduleCalendarSync(): void {
  if (!calendarSupported()) return
  if (timer != null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void syncCalendar()
  }, DEBOUNCE_MS)
}

export async function openCalendarSettings(): Promise<void> {
  if (!calendarSupported()) return
  try {
    await TtCalendar.openAppSettings()
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 打开系统日历 ---------------- */

export async function hasCalendarApp(): Promise<boolean> {
  if (!calendarSupported()) return false
  try {
    return (await TtCalendar.hasCalendarApp()).available
  } catch {
    return false
  }
}

export async function openSystemCalendar(at: number = Date.now()): Promise<boolean> {
  if (!calendarSupported()) return false
  try {
    await TtCalendar.openCalendar({ at })
    return true
  } catch {
    return false
  }
}
