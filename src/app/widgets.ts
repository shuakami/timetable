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
  openChannelSettings(o: { channelId: string }): Promise<void>
  openAutostartSettings(): Promise<{ vendor: boolean }>
  addListener(event: 'systemDark', cb: (o: { dark: boolean }) => void): Promise<PluginListenerHandle>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

const native = () => Capacitor.getPlatform() === 'android'

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

/** 查询电池优化状态 */
export async function batteryOptimizationsIgnored(): Promise<boolean> {
  if (!native()) return true
  try {
    return (await WidgetBridge.requestIgnoreBatteryOptimizations()).ignoring
  } catch {
    return true
  }
}

/** 打开自启动设置页（ColorOS / MIUI / Flyme 各有专属页）；没有专属页时打开应用详情，返回 false */
export async function openAutostartSettings(): Promise<boolean> {
  if (!native()) return false
  try {
    return (await WidgetBridge.openAutostartSettings()).vendor
  } catch {
    return false
  }
}

/** 打开通知渠道的系统设置页 */
export function openChannelSettings(channelId: string): void {
  if (!native()) return
  WidgetBridge.openChannelSettings({ channelId }).catch(() => undefined)
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
