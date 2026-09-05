import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { planCalendar } from '../domain/calendar-plan'
import { ICS_MIME, buildIcs, icsFileName } from '../domain/ics'
import { store } from './store'

/* 课表文件进出：导出 .ics 走系统分享面板；别人发来的 .ics 用课程表打开后进导入 */

interface IncomingFile {
  text?: string
  name?: string
}

interface TtFilesPlugin {
  share(o: { text: string; name: string; mime: string }): Promise<void>
  takeIncoming(): Promise<IncomingFile>
  addListener(event: 'incoming', fn: (f: IncomingFile) => void): Promise<PluginListenerHandle>
}

const TtFiles = registerPlugin<TtFilesPlugin>('TtFiles')

export const filesSupported = () => Capacitor.getPlatform() === 'android'

/** 当前学期的课表 .ics 文本；没有学期时为 null */
export function currentIcs(): { text: string; name: string } | null {
  const snap = store.snapshot()
  if (!snap) return null
  const events = planCalendar(snap, [], store.state.prefs, new Date()).filter((e) => e.kind === 'course')
  const sem = snap.semester
  const text = buildIcs(events, {
    name: sem.name,
    semester: { name: sem.name, startDate: sem.startDate, totalWeeks: sem.totalWeeks, timeGrid: sem.timeGrid },
    colors: new Map(snap.courses.map((c) => [c.id, c.color])),
  })
  return { text, name: icsFileName(sem.name) }
}

/** 分享当前学期课表；没有学期或平台不支持时返回 false */
export async function shareIcs(): Promise<boolean> {
  const f = currentIcs()
  if (!f) return false
  if (!filesSupported()) {
    const blob = new Blob([f.text], { type: ICS_MIME })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = f.name
    a.click()
    URL.revokeObjectURL(a.href)
    return true
  }
  await TtFiles.share({ text: f.text, name: f.name, mime: ICS_MIME })
  return true
}

function isCalendarText(text: string | undefined): text is string {
  return !!text && /BEGIN:VCALENDAR/i.test(text.slice(0, 2048))
}

/** 有人用课程表打开了 .ics：启动时带进来的那份立刻给，之后到的持续给 */
export function onIncomingIcs(fn: (text: string) => void): () => void {
  if (!filesSupported()) return () => undefined
  let handle: PluginListenerHandle | null = null
  let off = false
  TtFiles.addListener('incoming', (f) => { if (isCalendarText(f.text)) fn(f.text) }).then((h) => {
    if (off) h.remove()
    else handle = h
    // 监听挂上后再取，启动时带进来的文件不会丢
    TtFiles.takeIncoming().then((f) => { if (!off && isCalendarText(f.text)) fn(f.text) }).catch(() => undefined)
  }).catch(() => undefined)
  return () => {
    off = true
    handle?.remove()
  }
}
