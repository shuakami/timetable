import { useSyncExternalStore } from 'react'
import { syncNativeTheme, watchDynamicColors, watchSystemDark } from './widgets'

export type ThemePref = 'system' | 'light' | 'dark' | 'black'
export type Resolved = 'light' | 'dark' | 'black'

export const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
  black: '纯黑',
}

const KEY = 'tt.theme'
const DYN_KEY = 'tt.dynamic'
const BG: Record<Resolved, string> = { light: '#F7F7F6', dark: '#111214', black: '#000000' }
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): ThemePref {
  const v = new URLSearchParams(window.location.search).get('theme') ?? localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'black' ? v : 'system'
}

let pref: ThemePref = read()
/** 跟随系统配色（Material You）：默认关，用户手动开 */
let dynamic = localStorage.getItem(DYN_KEY) === '1'
/** 原生上报的系统主色调板（tone 100 → 0）；不支持或未知为 null */
let palette: string[] | null = null

/** 页面里的主题色变量→色板下标；浅色用深 tone 做主色，深色反之 */
const DYN_VARS = ['--c-accent', '--c-accent2', '--c-accent-soft', '--c-accent-line', '--c-mono-key'] as const
const DYN_TONE: Record<Resolved, [number, number, number, number, number]> = {
  light: [8, 6, 2, 4, 7],
  dark: [4, 5, 10, 9, 5],
  black: [4, 5, 11, 9, 5],
}

function applyDynamic(r: Resolved) {
  const st = document.documentElement.style
  if (!dynamic || !palette) {
    DYN_VARS.forEach((v) => st.removeProperty(v))
    return
  }
  const tones = DYN_TONE[r]
  DYN_VARS.forEach((v, i) => st.setProperty(v, palette![tones[i]]))
}
/** 原生上报的系统深浅色；未知时退回 media query */
let nativeDark: boolean | null = null

function systemDark(): boolean {
  return nativeDark ?? media.matches
}

export function resolve(p: ThemePref = pref): Resolved {
  return p === 'system' ? (systemDark() ? 'dark' : 'light') : p
}

function apply() {
  const r = resolve()
  const root = document.documentElement
  if (r === 'light') delete root.dataset.theme
  else root.dataset.theme = r
  applyDynamic(r)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', BG[r])
  syncNativeTheme(BG[r], r === 'light', pref === 'system')
  listeners.forEach((l) => l())
}

export function getTheme(): ThemePref {
  return pref
}

export function setTheme(p: ThemePref) {
  pref = p
  if (p === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, p)
  apply()
}

export function getDynamic(): boolean {
  return dynamic
}

/** 设备能提供系统色板（Android 12+）时才显示开关 */
export function dynamicSupported(): boolean {
  return palette !== null
}

export function setDynamic(on: boolean) {
  dynamic = on
  if (on) localStorage.setItem(DYN_KEY, '1')
  else localStorage.removeItem(DYN_KEY)
  apply()
}

/** 启动时同步一次，并跟随系统切换 */
export function initTheme() {
  apply()
  watchDynamicColors((o) => {
    const next = o.supported && o.accent && o.accent.length === 13 ? o.accent : null
    if (JSON.stringify(next) === JSON.stringify(palette)) return
    palette = next
    apply()
  })
  media.addEventListener('change', () => {
    if (pref === 'system') apply()
  })
  watchSystemDark((dark) => {
    if (nativeDark === dark) return
    nativeDark = dark
    if (pref === 'system') apply()
  })
}

export function useTheme(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pref,
  )
}

/** [是否开启, 设备是否支持] */
export function useDynamic(): [boolean, boolean] {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => `${dynamic ? 1 : 0}${palette ? 1 : 0}`,
  )
  return [s[0] === '1', s[1] === '1']
}
