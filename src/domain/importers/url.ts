import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { RuleInputKind } from '../rules'
 
/* URL 导入：抓取内容并嗅探类型。原生端走 CapacitorHttp（无 CORS 限制），
   Web 端走 fetch（受目标站 CORS 约束，失败时提示改用粘贴）。 */
 
export interface FetchedInput {
  text: string
  kind: RuleInputKind
}
 
export function sniffKind(text: string, contentType = ''): RuleInputKind {
  const t = text.trimStart()
  if (/text\/calendar/i.test(contentType) || t.startsWith('BEGIN:VCALENDAR')) return 'ics'
  if (/application\/json/i.test(contentType) || t.startsWith('{') || t.startsWith('[')) return 'json'
  if (/text\/html/i.test(contentType) || /^<!doctype html|^<html|<table/i.test(t)) return 'html'
  return 'csv'
}
 
export async function fetchUrl(url: string): Promise<FetchedInput> {
  if (!/^https?:\/\//i.test(url)) throw new Error('链接需要以 http(s):// 开头')
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, responseType: 'text', readTimeout: 15000, connectTimeout: 15000 })
    if (res.status >= 400) throw new Error(`请求失败：HTTP ${res.status}`)
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return { text, kind: sniffKind(text, String(res.headers?.['Content-Type'] ?? res.headers?.['content-type'] ?? '')) }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
  const text = await res.text()
  return { text, kind: sniffKind(text, res.headers.get('content-type') ?? '') }
}
