import { useSyncExternalStore } from 'react'
import { syncNativeTheme, watchSystemDark } from './widgets'

export type ThemePref = 'system' | 'light' | 'dark' | 'black'
export type Resolved = 'light' | 'dark' | 'black'

export const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
  black: '纯黑',
}

const KEY = 'tt.theme'
const BG: Record<Resolved, string> = { light: '#F7F7F6', dark: '#111214', black: '#000000' }
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): ThemePref {
  const v = new URLSearchParams(window.location.search).get('theme') ?? localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'black' ? v : 'system'
}

let pref: ThemePref = read()
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
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', BG[r])
  syncNativeTheme(BG[r], r === 'light')
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

/** 启动时同步一次，并跟随系统切换 */
export function initTheme() {
  apply()
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
