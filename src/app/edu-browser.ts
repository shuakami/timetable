import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { PAGE_HTML_JS, PAGE_TEXT_JS, PROBE_JS, wrapRun, zfFetchJs, type ProbeResult } from '../domain/edu/scripts'
import type { ZfKb } from '../domain/edu/zhengfang'
import { uid } from '../domain/store'

/**
 * 内置浏览器（原生 TtEdu 插件）的 TS 包装。
 * 页面由用户自己登录；这里只在用户点「导入」（以及到了课表页后探测课程数）时往页面里注入脚本读取结果。
 * 浏览器环境没有原生 WebView：open/close 等全部 no-op，run 直接拒绝。
 */

export interface EduNav {
  url: string
  title: string
  loading: boolean
  progress: number
  canGoBack: boolean
  /** 本次会话里学校页面已画出首帧 */
  painted: boolean
  /** 主文档加载失败；'ssl' 为证书错误 */
  error?: string
}

export interface EduRect {
  x: number
  y: number
  w: number
  h: number
}

/** 透明区：top 以上、bottom 以下是应用自己的界面；keep 里的矩形（悬浮胶囊）也留给应用 */
export interface EduFrame {
  top: number
  bottom: number
  keep: EduRect[]
  interactive: boolean
}

/** 不可见 WebView 的主文档结果 */
export interface EduBgNav {
  url: string
  title: string
  error?: string
}

interface TtEduPlugin {
  open(o: { url: string; profile?: string; keep?: boolean }): Promise<{ persistent: boolean }>
  close(o: { keep?: boolean }): Promise<void>
  profiles(): Promise<{ supported: boolean }>
  clearProfile(o: { profile: string }): Promise<{ ok: boolean }>
  bgOpen(o: { url: string; profile?: string }): Promise<void>
  bgEval(o: { js: string }): Promise<{ value: string }>
  bgClose(): Promise<void>
  navigate(o: { url: string }): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  back(): Promise<{ went: boolean }>
  frame(o: EduFrame): Promise<void>
  snapshot(): Promise<{ src: string }>
  eval(o: { js: string }): Promise<{ value: string }>
  state(): Promise<EduNav>
  addListener(event: 'nav', fn: (e: EduNav) => void): Promise<PluginListenerHandle>
  addListener(event: 'message', fn: (e: { data: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'bgNav', fn: (e: EduBgNav) => void): Promise<PluginListenerHandle>
}

const TtEdu = registerPlugin<TtEduPlugin>('TtEdu')

export const nativeEdu = () => Capacitor.getPlatform() === 'android'

export const RUN_TIMEOUT = 20_000

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: number
}

const pending = new Map<string, Pending>()
let messageHandle: Promise<PluginListenerHandle> | null = null

/** 页面脚本的回传：{ id, ok, r | e } */
export function settleMessage(data: string): boolean {
  let msg: { id?: unknown; ok?: unknown; r?: unknown; e?: unknown }
  try {
    msg = JSON.parse(data) as typeof msg
  } catch {
    return false
  }
  if (typeof msg.id !== 'string') return false
  const p = pending.get(msg.id)
  if (!p) return false
  pending.delete(msg.id)
  window.clearTimeout(p.timer)
  if (msg.ok) p.resolve(msg.r ?? null)
  else p.reject(new Error(typeof msg.e === 'string' && msg.e ? msg.e : '脚本执行失败'))
  return true
}

function ensureMessageListener() {
  if (messageHandle) return
  messageHandle = TtEdu.addListener('message', (e) => {
    settleMessage(e.data)
  })
}

function rejectAll(reason: string) {
  for (const [, p] of pending) {
    window.clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

/** 在学校页面里跑一段 async 函数体，等它经 TtBridge.post 回传的结果；bg 为自动更新的不可见页面 */
export function run<T>(body: string, timeout = RUN_TIMEOUT, bg = false): Promise<T> {
  if (!nativeEdu()) return Promise.reject(new Error('内置浏览器仅在应用内可用'))
  ensureMessageListener()
  const id = uid()
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('页面没有响应'))
    }, timeout)
    pending.set(id, { resolve: (v) => resolve(v as T), reject, timer })
    const js = wrapRun(id, body)
    ;(bg ? TtEdu.bgEval({ js }) : TtEdu.eval({ js })).catch((e: unknown) => {
      if (!pending.has(id)) return
      pending.delete(id)
      window.clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    })
  })
}

/** 每所学校一个 WebView Profile，按教务站的主机名区分 */
export function eduProfile(url: string): string {
  let host = url
  try {
    host = new URL(url).host
  } catch {
    host = url.replace(/^https?:\/\//, '').split('/')[0]
  }
  return `edu-${host.toLowerCase().replace(/[^a-z0-9.-]/g, '_')}`
}

export const edu = {
  /** keep：保留上次会话（用户开了保持登录）；返回本次会话是否落在独立 Profile 里 */
  open: (url: string, keep = false): Promise<boolean> =>
    nativeEdu() ? TtEdu.open({ url, profile: eduProfile(url), keep }).then((r) => r.persistent, () => false) : Promise.resolve(false),
  close: (keep = false) => {
    rejectAll('浏览器已关闭')
    return nativeEdu() ? TtEdu.close({ keep }) : Promise.resolve()
  },
  /** 系统 WebView 是否支持多 Profile（保持登录的前提） */
  profiles: (): Promise<boolean> => (nativeEdu() ? TtEdu.profiles().then((r) => r.supported, () => false) : Promise.resolve(false)),
  clearProfile: (url: string): Promise<boolean> =>
    nativeEdu() ? TtEdu.clearProfile({ profile: eduProfile(url) }).then((r) => r.ok, () => false) : Promise.resolve(false),
  bgOpen: (url: string) => (nativeEdu() ? TtEdu.bgOpen({ url, profile: eduProfile(url) }) : Promise.reject(new Error('仅在应用内可用'))),
  bgClose: () => (nativeEdu() ? TtEdu.bgClose() : Promise.resolve()),
  onBgNav: (fn: (e: EduBgNav) => void): (() => void) => {
    if (!nativeEdu()) return () => {}
    const h = TtEdu.addListener('bgNav', fn)
    return () => void h.then((x) => x.remove())
  },
  bgZfFetch: (xnm: string, xqm: string) => run<ZfKb[]>(zfFetchJs(xnm, xqm), RUN_TIMEOUT, true),
  bgPageHtml: () => run<string>(PAGE_HTML_JS, RUN_TIMEOUT, true),
  navigate: (url: string) => (nativeEdu() ? TtEdu.navigate({ url }) : Promise.resolve()),
  reload: () => (nativeEdu() ? TtEdu.reload() : Promise.resolve()),
  stop: () => (nativeEdu() ? TtEdu.stop() : Promise.resolve()),
  /** 当前学校页面的定格图（data URL）；退场时贴在透明洞里随页一起滑走 */
  snapshot: (): Promise<string | null> => (nativeEdu() ? TtEdu.snapshot().then((r) => r.src || null, () => null) : Promise.resolve(null)),
  back: () => (nativeEdu() ? TtEdu.back() : Promise.resolve({ went: false })),
  frame: (f: EduFrame) => (nativeEdu() ? TtEdu.frame(f) : Promise.resolve()),
  state: (): Promise<EduNav | null> => (nativeEdu() ? TtEdu.state() : Promise.resolve(null)),
  /** 订阅页面导航事件；返回取消函数 */
  onNav: (fn: (e: EduNav) => void): (() => void) => {
    if (!nativeEdu()) return () => {}
    const h = TtEdu.addListener('nav', fn)
    return () => void h.then((x) => x.remove())
  },
  probe: () => run<ProbeResult>(PROBE_JS),
  zfFetch: (xnm: string, xqm: string) => run<ZfKb[]>(zfFetchJs(xnm, xqm)),
  pageHtml: () => run<string>(PAGE_HTML_JS),
  pageText: () => run<string>(PAGE_TEXT_JS),
}
