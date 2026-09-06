import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { WidgetStyle } from '../domain/types'
import { buildWidgetData } from '../domain/widget-data'
import { store } from './store'

interface WidgetBridgePlugin {
  setData(o: { json: string }): Promise<void>
  isPinSupported(): Promise<{ supported: boolean }>
  requestPin(o: { style: WidgetStyle }): Promise<{ requested: boolean }>
  ready(): Promise<void>
  setTheme(o: { bg: string; light: boolean; system: boolean }): Promise<void>
  systemDark(): Promise<{ dark: boolean }>
  dynamicColors(): Promise<DynamicColors>
  toast(o: { text: string }): Promise<void>
  copy(o: { text: string }): Promise<void>
  paste(): Promise<{ text: string }>
  haptic(o: { kind: HapticKind }): Promise<void>
  openAppSettings(): Promise<void>
  addListener(event: 'systemDark', cb: (o: { dark: boolean }) => void): Promise<PluginListenerHandle>
  addListener(event: 'dynamicColors', cb: (o: DynamicColors) => void): Promise<PluginListenerHandle>
}

/** Material You 主色调板：tone 100 → 0 共 13 级 hex；12 以下 supported 为 false */
export interface DynamicColors {
  supported: boolean
  accent?: string[]
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

const native = () => Capacitor.getPlatform() === 'android'

/** 首帧画完，通知原生收走系统开屏 */
export function notifyWebReady(): void {
  if (!native()) return
  WidgetBridge.ready().catch(() => undefined)
}

/** 窗口底色、系统栏和桌面小组件跟随页面主题；system 表示用户选的是「跟随系统」 */
export function syncNativeTheme(bg: string, light: boolean, system: boolean): void {
  if (!native()) return
  WidgetBridge.setTheme({ bg, light, system }).catch(() => undefined)
}

export function nativeToast(text: string): void {
  if (!native()) return
  WidgetBridge.toast({ text }).catch(() => undefined)
}

/** 写剪贴板：原生走 ClipboardManager，浏览器走 navigator.clipboard，都不行时回退到隐藏 textarea + execCommand */
export async function copyText(text: string): Promise<boolean> {
  if (native()) {
    try {
      await WidgetBridge.copy({ text })
      return true
    } catch {
      /* 落到下面的 web 路径 */
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 不安全上下文或无权限 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 读剪贴板：原生一定能读；浏览器取不到时返回空串，调用方自己改为聚焦输入框 */
export async function pasteText(): Promise<string> {
  if (native()) {
    try {
      return (await WidgetBridge.paste()).text
    } catch {
      return ''
    }
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export type HapticKind = 'tick' | 'edge' | 'select' | 'press' | 'reject'

/** 触感反馈：原生走系统 HapticFeedbackConstants（滚轮刻度 / 确认 / 边界），浏览器里安静 */
export function haptic(kind: HapticKind = 'tick'): void {
  if (!native()) return
  WidgetBridge.haptic({ kind }).catch(() => undefined)
}

/** 系统里本应用的详情页（权限） */
export function openAppSettings(): void {
  if (!native()) return
  WidgetBridge.openAppSettings().catch(() => undefined)
}

/** 系统深浅色以原生 uiMode 为准：先取当前值，之后跟随变化 */
export function watchSystemDark(cb: (dark: boolean) => void): void {
  if (!native()) return
  WidgetBridge.systemDark().then((o) => cb(o.dark)).catch(() => undefined)
  void WidgetBridge.addListener('systemDark', (o) => cb(o.dark)).catch(() => undefined)
}

/** 系统动态色板：启动取一次，回前台时原生再推（壁纸换色） */
export function watchDynamicColors(cb: (o: DynamicColors) => void): void {
  if (!native()) return
  WidgetBridge.dynamicColors().then(cb).catch(() => undefined)
  void WidgetBridge.addListener('dynamicColors', cb).catch(() => undefined)
}

/** 把课表快照写给桌面小组件并触发重绘 */
export async function syncWidgets(): Promise<void> {
  if (!native()) return
  try {
    const s = store.state
    const data = buildWidgetData(store.snapshot(), s.prefs.widgetStyle, new Date())
    await WidgetBridge.setData({ json: JSON.stringify(data) })
  } catch {
    /* 没装小组件时忽略 */
  }
}

export async function widgetPinSupported(): Promise<boolean> {
  if (!native()) return false
  try {
    return (await WidgetBridge.isPinSupported()).supported
  } catch {
    return false
  }
}

/** 让系统弹出「添加到桌面」 */
export async function addWidgetToHome(style: WidgetStyle): Promise<boolean> {
  if (!native()) return false
  try {
    await syncWidgets()
    return (await WidgetBridge.requestPin({ style })).requested
  } catch {
    return false
  }
}
