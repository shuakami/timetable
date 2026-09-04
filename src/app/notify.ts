import { Capacitor } from '@capacitor/core'
import { LocalNotifications, type ScheduleOptions } from '@capacitor/local-notifications'
import { store } from './store'
import { planNotifications, stableId, type PlannedNotification } from '../domain/notify-plan'
import { uid } from '../domain/store'

/* 本地通知：把 planNotifications 的结果落到系统调度上。
   每次重排先撤掉自己排过的，再整批下发，保证与课表一致。 */

const CHANNEL = 'timetable'
const native = () => Capacitor.isNativePlatform()

type Nav = 'today' | 'changes' | 'todo'
let router: ((to: Nav) => void) | null = null
export function setNotificationRouter(fn: (to: Nav) => void) {
  router = fn
}

export async function notificationsAllowed(): Promise<boolean> {
  if (!native()) return false
  const { display } = await LocalNotifications.checkPermissions()
  return display === 'granted'
}

export async function requestNotifications(): Promise<boolean> {
  if (!native()) return false
  const { display } = await LocalNotifications.requestPermissions()
  return display === 'granted'
}

/** Android 12+ 的「闹钟和提醒」权限；没有它，系统可能把通知延后几十分钟 */
export async function exactAlarmsAllowed(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return true
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting()
    return exact_alarm === 'granted'
  } catch {
    return true
  }
}

export async function requestExactAlarms(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return true
  try {
    const { exact_alarm } = await LocalNotifications.changeExactNotificationSetting()
    return exact_alarm === 'granted'
  } catch {
    return false
  }
}

/** 测试通知：at 为空立即弹出，否则定时；group 标成 snooze 以免被重排时撤掉 */
export async function scheduleTestNotification(at?: Date): Promise<boolean> {
  if (!native()) return false
  try {
    if (!(await notificationsAllowed())) return false
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [{
        id: stableId(at ? 'test:timed' : 'test:now'),
        title: at ? '定时通知测试' : '通知测试',
        body: at ? '定时提醒能正常送达。' : '通知本身正常，接下来试定时。',
        channelId: CHANNEL,
        ...(at ? { schedule: { at, allowWhileIdle: true } } : {}),
        extra: { group: 'snooze' },
      }],
    })
    return true
  } catch {
    return false
  }
}

async function ensureChannel() {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: '课程表',
      description: '上课、作业与课表变更',
      importance: 4,
      visibility: 1,
    })
  } catch {
    /* 已存在时忽略 */
  }
}

async function ensureActions() {
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        { id: 'class', actions: [{ id: 'mute', title: '本节静音' }, { id: 'today', title: '今天' }] },
        { id: 'task', actions: [{ id: 'done', title: '完成' }, { id: 'snooze', title: '稍后提醒' }] },
        { id: 'change', actions: [{ id: 'changes', title: '变更' }] },
      ],
    })
  } catch {
    /* 平台不支持时忽略 */
  }
}

function toSchedule(list: PlannedNotification[]): ScheduleOptions {
  return {
    notifications: list.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      channelId: CHANNEL,
      actionTypeId: n.actionTypeId,
      schedule: { at: new Date(n.at), allowWhileIdle: true },
      extra: { group: n.group, ruleId: n.ruleId, date: n.date, taskId: n.taskId },
    })),
  }
}

let syncing = false

/** 按当前 Store 重排未来 7 天的通知 */
export async function syncNotifications(): Promise<void> {
  if (!native() || syncing) return
  syncing = true
  try {
    if (!(await notificationsAllowed())) return
    await ensureChannel()
    await ensureActions()
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => (n.extra as { group?: string } | undefined)?.group !== 'snooze')
    if (stale.length > 0) await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
    const s = store.state
    const plan = planNotifications(store.snapshot(), s.tasks, s.prefs, new Date())
    if (plan.length > 0) await LocalNotifications.schedule(toSchedule(plan.slice(0, 120)))
  } catch {
    /* 调度失败不影响使用 */
  } finally {
    syncing = false
  }
}

/** 调课、停课、导入差异这类立刻要知道的事 */
export async function pushChange(title: string, body: string): Promise<void> {
  if (!native() || !store.state.prefs.changePush) return
  try {
    if (!(await notificationsAllowed())) return
    await ensureChannel()
    await ensureActions()
    await LocalNotifications.schedule({
      notifications: [{
        id: stableId(`change:${Date.now()}:${uid()}`),
        title,
        body,
        channelId: CHANNEL,
        actionTypeId: 'change',
        extra: { group: 'change' },
      }],
    })
  } catch {
    /* 忽略 */
  }
}

function snoozeAt(): Date {
  const d = new Date()
  const evening = new Date(d)
  evening.setHours(21, 0, 0, 0)
  if (evening.getTime() - d.getTime() < 30 * 60000) return new Date(d.getTime() + 2 * 3600000)
  return evening
}

/** 通知上的操作按钮：静音本节 / 标记完成 / 晚上再提醒 / 跳转 */
export function attachNotificationActions() {
  if (!native()) return
  LocalNotifications.addListener('localNotificationActionPerformed', async (ev) => {
    const extra = (ev.notification.extra ?? {}) as { ruleId?: string; date?: string; taskId?: string }
    switch (ev.actionId) {
      case 'mute':
        if (extra.ruleId && extra.date) {
          store.addOverride({ id: uid(), kind: 'muted', ruleId: extra.ruleId, date: extra.date, createdAt: Date.now() })
          void syncNotifications()
        }
        break
      case 'done':
        if (extra.taskId) {
          store.editTask(extra.taskId, { done: true })
          void syncNotifications()
        }
        break
      case 'snooze':
        if (extra.taskId) {
          const t = store.state.tasks.find((x) => x.id === extra.taskId)
          if (t) {
            await LocalNotifications.schedule({
              notifications: [{
                id: stableId(`snooze:${t.id}`),
                title: ev.notification.title ?? t.title,
                body: ev.notification.body ?? '',
                channelId: CHANNEL,
                actionTypeId: 'task',
                schedule: { at: snoozeAt(), allowWhileIdle: true },
                extra: { group: 'snooze', taskId: t.id },
              }],
            })
          }
        }
        break
      case 'changes':
        router?.('changes')
        break
      case 'today':
      case 'tap':
      default:
        router?.(extra.taskId ? 'todo' : 'today')
    }
  })
}
