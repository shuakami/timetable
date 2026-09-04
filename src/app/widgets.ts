import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { WidgetStyle } from '../domain/types'
import { buildWidgetData } from '../domain/widget-data'
import { store } from './store'

interface WidgetBridgePlugin {
  setData(o: { json: string }): Promise<void>
  isPinSupported(): Promise<{ supported: boolean }>
  requestPin(o: { style: WidgetStyle }): Promise<{ requested: boolean }>
  ready(): Promise<void>
  setTheme(o: { bg: string; light: boolean }): Promise<void>
  systemDark(): Promise<{ dark: boolean }>
  toast(o: { text: string }): Promise<void>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>
  pickDate(o: { value: string }): Promise<{ value: string }>
  pickTime(o: { value: string }): Promise<{ value: string }>
  pickOption(o: { options: string[]; selected: number; title?: string }): Promise<{ index: number }>
  addListener(event: 'systemDark', cb: (o: { dark: boolean }) => void): Promise<PluginListenerHandle>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

const native = () => Capacitor.getPlatform() === 'android'

/** 原生系统选择器可用（Android），否则用网页控件 */
export const hasNativePickers = native

/** 系统日期选择，取消返回 null */
export async function nativePickDate(value: string): Promise<string | null> {
  try {
    const r = await WidgetBridge.pickDate({ value })
    return r.value || null
  } catch {
    return null
  }
}

export async function nativePickTime(value: string): Promise<string | null> {
  try {
    const r = await WidgetBridge.pickTime({ value })
    return r.value || null
  } catch {
    return null
  }
}

/** 系统单选列表，取消返回 null */
export async function nativePickOption(options: string[], selected: number, title?: string): Promise<number | null> {
  try {
    const r = await WidgetBridge.pickOption({ options, selected, title })
    return r.index >= 0 ? r.index : null
  } catch {
    return null
  }
}

/** 首帧画完，通知原生收走系统开屏 */
export function notifyWebReady(): void {
  if (!native()) return
  WidgetBridge.ready().catch(() => undefined)
}

/** 窗口底色与系统栏跟随页面主题 */
export function syncNativeTheme(bg: string, light: boolean): void {
  if (!native()) return
  WidgetBridge.setTheme({ bg, light }).catch(() => undefined)
}

/** 请求加入电池优化白名单；已在名单返回 true */
export async function requestIgnoreBattery(): Promise<boolean> {
  if (!native()) return true
  try {
    return (await WidgetBridge.requestIgnoreBatteryOptimizations()).ignoring
  } catch {
    return false
  }
}

export function nativeToast(text: string): void {
  if (!native()) return
  WidgetBridge.toast({ text }).catch(() => undefined)
}

/** 系统深浅色以原生 uiMode 为准：先取当前值，之后跟随变化 */
export function watchSystemDark(cb: (dark: boolean) => void): void {
  if (!native()) return
  WidgetBridge.systemDark().then((o) => cb(o.dark)).catch(() => undefined)
  void WidgetBridge.addListener('systemDark', (o) => cb(o.dark)).catch(() => undefined)
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
