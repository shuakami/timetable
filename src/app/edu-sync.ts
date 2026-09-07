/**
 * 教务自动更新：保留学校的 WebView 会话（只有 Cookie，不存账号密码），
 * 在不可见 WebView 里打开课表页，用导入时同一套脚本取课表，走同一套合并逻辑。
 * 会话失效只标记「需要重新登录」，不重试；连续三次失效自动关闭。
 */
import { useSyncExternalStore } from 'react'
import type { RuleManifest } from '../domain/rules'
import type { School } from '../domain/edu/schools'
import { detectSystem, isTimetablePage } from '../domain/edu/systems'
import { parseZfKbList, termLabel, type ZfKb, type ZfTerm } from '../domain/edu/zhengfang'
import { parseHtml } from '../domain/importers/html'
import { diffImport, normalize, type NormalizedCourse, type RuleOutput } from '../domain/importer'
import type { SessionRule } from '../domain/types'
import { uid } from '../domain/store'
import { store } from './store'
import { extendGrid, semesterEnded } from './semester'
import { edu, eduProfile, nativeEdu, type EduBgNav } from './edu-browser'

export const EDU_RULE: RuleManifest = { id: 'builtin-edu', name: '教务系统', version: '1.0', input: 'json', createdAt: 0, updatedAt: 0 }

export type EduSyncResult = 'ok' | 'nochange' | 'expired' | 'error'

/** 导入时记下的抓取来源：学校、当时所在的课表页、正方选的学期 */
export interface EduSyncSource {
  school: School
  pageUrl: string
  term?: ZfTerm
}

export interface EduSync extends EduSyncSource {
  enabled: boolean
  lastAt: number
  lastResult: EduSyncResult | ''
  lastChanges: number
  failStreak: number
}

export interface SyncOutcome {
  result: EduSyncResult
  changes: number
  message?: string
  /** 连续失效自动关闭时的提示 */
  note?: string
}

const KEY = 'tt.edu.sync'
const PAGE_TIMEOUT = 45_000
const RESUME_GAP = 6 * 3600_000
/** 连续失效几次后自动关闭 */
const MAX_EXPIRED = 3

let cur: EduSync | null | undefined
const subs = new Set<() => void>()

function load(): EduSync | null {
  if (cur !== undefined) return cur
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as Partial<EduSync>) : null
    cur = v && v.school && typeof v.pageUrl === 'string'
      ? {
          school: v.school,
          pageUrl: v.pageUrl,
          term: v.term,
          enabled: !!v.enabled,
          lastAt: typeof v.lastAt === 'number' ? v.lastAt : 0,
          lastResult: v.lastResult ?? '',
          lastChanges: typeof v.lastChanges === 'number' ? v.lastChanges : 0,
          failStreak: typeof v.failStreak === 'number' ? v.failStreak : 0,
        }
      : null
  } catch {
    cur = null
  }
  return cur
}

function save(v: EduSync | null) {
  cur = v
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* 存不下也不影响本次 */
  }
  for (const fn of subs) fn()
}

export const getEduSync = (): EduSync | null => load()

export function useEduSync(): EduSync | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    load,
  )
}

/** 导入完成时开启：重新登录后再导入也走这里，失效计数清零 */
export function enableEduSync(src: EduSyncSource) {
  const prev = load()
  const same = prev && eduProfile(prev.school.url) === eduProfile(src.school.url)
  save({
    ...src,
    enabled: true,
    lastAt: same ? prev.lastAt : 0,
    lastResult: same && prev.lastResult !== 'expired' ? prev.lastResult : '',
    lastChanges: same ? prev.lastChanges : 0,
    failStreak: 0,
  })
}

export function setEduSyncEnabled(on: boolean) {
  const s = load()
  if (!s) return
  save({ ...s, enabled: on, failStreak: on ? 0 : s.failStreak })
}

/** 退出登录：删掉该学校的 WebView Profile 与记录 */
export async function logoutEduSync(): Promise<void> {
  const s = load()
  save(null)
  if (s) await edu.clearProfile(s.school.url)
}

/** 内置浏览器打开 / 离开这所学校时是否保留会话 */
export function keepEduSession(url: string): boolean {
  const s = load()
  return !!s && s.enabled && eduProfile(s.school.url) === eduProfile(url)
}

/** 内置浏览器正在前台时不做后台抓取 */
let browserOpen = false
export const setEduBrowserOpen = (v: boolean) => {
  browserOpen = v
}

function waitPage(): Promise<EduBgNav> {
  return new Promise((resolve, reject) => {
    let last: EduBgNav | null = null
    let settle = 0
    let off = () => {}
    const timer = window.setTimeout(() => {
      off()
      window.clearTimeout(settle)
      reject(new Error('页面没有响应'))
    }, PAGE_TIMEOUT)
    const done = () => {
      window.clearTimeout(timer)
      off()
      if (last) resolve(last)
      else reject(new Error('页面没有响应'))
    }
    /* 登录页常带跳转：等主文档稳定（800ms 内没有新的完成事件）再判定 */
    off = edu.onBgNav((e) => {
      window.clearTimeout(settle)
      last = e
      settle = window.setTimeout(done, 800)
    })
  })
}

const sig = (r: Pick<SessionRule, 'weekday' | 'startPeriod' | 'endPeriod' | 'weeksMask' | 'location'>) =>
  `${r.weekday}:${r.startPeriod}-${r.endPeriod}:${r.weeksMask}:${r.location ?? ''}`

/** 和当前课表相比会变的处数：新增、消失、恢复、排课变化、老师变化（用户改过的课不算） */
export function countChanges(incoming: NormalizedCourse[]): number {
  const st = store.state
  const edited = new Set(st.userEditedCourseIds)
  const ex = new Map(st.courses.filter((c) => c.source === 'import').map((c) => [c.identityKey, c]))
  const diff = diffImport(st.courses, incoming, edited)
  let n = diff.added.length + diff.removed.length
  for (const nc of incoming) {
    const c = ex.get(nc.course.identityKey)
    if (!c) continue
    if (c.removedByImport) {
      n++
      continue
    }
    const a = st.rules.filter((r) => r.courseId === c.id).map(sig).sort().join('|')
    const b = nc.rules.map(sig).sort().join('|')
    if (a !== b) n++
    else if (!edited.has(c.id) && (c.teacher ?? '') !== (nc.course.teacher ?? '')) n++
  }
  return n
}

/** 正方接口在未登录时返回登录页 HTML，JSON 解析失败 */
const looksExpired = (e: unknown) => e instanceof Error && /JSON|token|Unexpected/i.test(e.message)

function finish(s: EduSync, result: EduSyncResult, message?: string, changes = 0): SyncOutcome {
  const failStreak = result === 'expired' ? s.failStreak + 1 : result === 'error' ? s.failStreak : 0
  let enabled = s.enabled
  let note: string | undefined
  if (failStreak >= MAX_EXPIRED && enabled) {
    enabled = false
    note = '该学校不支持保持登录，已关闭自动更新'
  }
  save({ ...s, enabled, lastAt: Date.now(), lastResult: result, lastChanges: changes, failStreak })
  return { result, changes, message, note }
}

async function doSync(): Promise<SyncOutcome> {
  const s = load()
  if (!s) return { result: 'error', changes: 0, message: '未开启自动更新' }
  if (!nativeEdu()) return { result: 'error', changes: 0, message: '仅在应用内可用' }
  if (browserOpen) return { result: 'error', changes: 0, message: '浏览器打开中' }
  const sem = store.state.semester
  if (!sem || semesterEnded(sem)) return finish(s, 'error', '学期已结束')
  const t0 = performance.now()
  try {
    const page = waitPage()
    await edu.bgOpen(s.pageUrl)
    const nav = await page
    if (nav.error) return finish(s, 'error', '页面打不开')
    const sys = detectSystem(nav.url, s.school.system)
    if (!isTimetablePage(sys, nav.url, nav.title)) return finish(s, 'expired')

    let out: RuleOutput
    if (sys === 'zhengfang_new' && s.term) {
      let list: ZfKb[]
      try {
        list = await edu.bgZfFetch(s.term.xnm, s.term.xqm)
      } catch (e) {
        return finish(s, looksExpired(e) ? 'expired' : 'error', e instanceof Error ? e.message : undefined)
      }
      out = { ...parseZfKbList(list), semester: { name: termLabel(s.term) } }
    } else {
      out = parseHtml(await edu.bgPageHtml(), { mode: 'grid' })
    }
    if (out.courses.length === 0) return finish(s, 'error', '没有解析出课程')

    const need = Math.min(20, Math.max(0, ...out.courses.map((c) => c.endPeriod)))
    const target = need > sem.timeGrid.length ? { ...sem, timeGrid: extendGrid(sem.timeGrid, need) } : sem
    const pending = normalize(out, target)
    const changes = countChanges(pending.courses)
    if (changes === 0) return finish(s, 'nochange')
    if (target !== sem) store.setSemester(target)
    store.applyImport(pending.courses, {
      id: uid(), semesterId: target.id,
      ruleId: EDU_RULE.id, ruleName: EDU_RULE.name, ruleVersion: EDU_RULE.version,
      at: Date.now(), durationMs: Math.max(1, Math.round(performance.now() - t0)),
      failed: pending.diagnostics.filter((d) => d.level === 'error').length, diagnostics: pending.diagnostics,
    })
    return finish(s, 'ok', undefined, changes)
  } catch (e) {
    return finish(s, 'error', e instanceof Error ? e.message : undefined)
  } finally {
    await edu.bgClose().catch(() => {})
  }
}

let running: Promise<SyncOutcome> | null = null

/** 立即更新；同时只跑一个 */
export function syncNow(): Promise<SyncOutcome> {
  if (!running) {
    running = doSync().finally(() => {
      running = null
    })
  }
  return running
}

export const eduSyncing = () => running !== null

/** 回前台静默检查：开着、距上次超过 6 小时、上次不是失效 */
export function resumeSync(): Promise<SyncOutcome> | null {
  const s = load()
  if (!s || !s.enabled || browserOpen || running) return null
  if (s.lastResult === 'expired') return null
  if (Date.now() - s.lastAt < RESUME_GAP) return null
  return syncNow()
}

export function outcomeText(o: SyncOutcome): string {
  if (o.note) return o.note
  switch (o.result) {
    case 'ok':
      return `课表已更新，${o.changes} 处变更`
    case 'nochange':
      return '课表没有变化'
    case 'expired':
      return '需要重新登录'
    default:
      return o.message ? `更新失败，${o.message}` : '更新失败'
  }
}

function when(at: number): string {
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(today) - day(d)) / 86400_000)
  if (diff === 0) return `今天 ${hm}`
  if (diff === 1) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 学期页状态行文案 */
export function statusText(s: EduSync): { text: string; danger: boolean } {
  if (s.lastResult === 'expired') return { text: '需要重新登录', danger: true }
  if (!s.lastAt || !s.lastResult) return { text: s.enabled ? '还没更新过' : '已关闭', danger: false }
  const t = when(s.lastAt)
  if (s.lastResult === 'ok') return { text: `${t}，${s.lastChanges} 处变更`, danger: false }
  if (s.lastResult === 'nochange') return { text: `${t}，无变化`, danger: false }
  return { text: `${t}，更新失败`, danger: false }
}
