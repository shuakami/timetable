import { useEffect, useMemo, useState } from 'react'
import { Page, StickyHead, BackButton, TopBar, tint, WD, Tick } from './ui'
import { store, useStore } from './store'
import { addDays, fmtMinutes, weekOf, dateOf } from '../domain/dates'
import { todayStr } from './semester'
import { occurrencesOn, type Snapshot } from '../domain/engine'
import { TASK_LEADS, type Minutes, type Prefs, type WidgetStyle } from '../domain/types'
import { CHANNEL, exactAlarmsAllowed, notificationsAllowed, requestExactAlarms, requestNotifications, scheduleTestNotification, syncNotifications } from './notify'
import { addWidgetToHome, nativeToast, openChannelSettings, requestIgnoreBattery, syncWidgets, widgetPinSupported } from './widgets'

/* ---------------- 通知偏好 ---------------- */

type PrefKey =
  | 'classLead' | 'firstClassLead' | 'onlyChanged'
  | 'taskLeads' | 'examDays'
  | 'changePush' | 'importSummary'
  | 'muteInClass' | 'quiet' | 'silentFreeDay'

interface Option {
  label: string
  patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)
  match: (p: Prefs) => boolean
}

const mins = (m: Minutes) => fmtMinutes(m)

export const leadLabel = (m: Minutes) => (m % 1440 === 0 ? `${m / 1440} 天` : m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`)

/** 作业提醒摘要：按提前量从大到小 */
export function taskLeadsText(leads: Minutes[]): string {
  if (leads.length === 0) return '不提醒'
  return `截止前 ${[...leads].sort((a, b) => b - a).map(leadLabel).join('、')}`
}

const OPTIONS: Record<PrefKey, { title: string; sub?: string; multi?: boolean; options: Option[] }> = {
  classLead: {
    title: '开课前提醒',
    options: [5, 10, 15, 20, 30, 45].map((n) => ({
      label: `${n} 分钟`,
      patch: { classLead: n },
      match: (p) => p.classLead === n,
    })),
  },
  firstClassLead: {
    title: '第一节课加早提醒',
    options: [
      { label: '不加早', patch: { firstClassLead: 0 }, match: (p) => p.firstClassLead === 0 },
      ...[20, 30, 40, 60].map((n) => ({
        label: `提前 ${n} 分钟`,
        patch: { firstClassLead: n },
        match: (p: Prefs) => p.firstClassLead === n,
      })),
    ],
  },
  onlyChanged: {
    title: '只提醒有变化的课',
    options: [
      { label: '开', patch: { onlyChanged: true }, match: (p) => p.onlyChanged },
      { label: '关', patch: { onlyChanged: false }, match: (p) => !p.onlyChanged },
    ],
  },
  taskLeads: {
    title: '作业截止',
    sub: '按截止时刻往前推，可选多个。落在夜间不打扰里的提前到当晚。',
    multi: true,
    options: TASK_LEADS.map((m) => ({
      label: `前 ${leadLabel(m)}`,
      patch: (p: Prefs) => ({ taskLeads: p.taskLeads.includes(m) ? p.taskLeads.filter((x) => x !== m) : [...p.taskLeads, m] }),
      match: (p: Prefs) => p.taskLeads.includes(m),
    })),
  },
  examDays: {
    title: '考试倒数',
    options: [
      { label: '3 天、当天早上', patch: { examDays: [3, 0] }, match: (p) => p.examDays.join() === '3,0' },
      { label: '7 天、3 天、当天早上', patch: { examDays: [7, 3, 0] }, match: (p) => p.examDays.join() === '7,3,0' },
      { label: '当天早上', patch: { examDays: [0] }, match: (p) => p.examDays.join() === '0' },
      { label: '不提醒', patch: { examDays: [] }, match: (p) => p.examDays.length === 0 },
    ],
  },
  changePush: {
    title: '调课与停课',
    options: [
      { label: '立刻推送', patch: { changePush: true }, match: (p) => p.changePush },
      { label: '不推送', patch: { changePush: false }, match: (p) => !p.changePush },
    ],
  },
  importSummary: {
    title: '重新导入后的变化',
    options: [
      { label: '推送一条', patch: { importSummary: true }, match: (p) => p.importSummary },
      { label: '不提醒', patch: { importSummary: false }, match: (p) => !p.importSummary },
    ],
  },
  muteInClass: {
    title: '上课中静音',
    options: [
      { label: '开', patch: { muteInClass: true }, match: (p) => p.muteInClass },
      { label: '关', patch: { muteInClass: false }, match: (p) => !p.muteInClass },
    ],
  },
  quiet: {
    title: '夜间不打扰',
    options: [
      ...([[23 * 60, 7 * 60], [22 * 60, 8 * 60], [0, 6 * 60]] as [number, number][]).map(([s, e]) => ({
        label: `${mins(s)} – ${mins(e)}`,
        patch: { quietStart: s, quietEnd: e },
        match: (p: Prefs) => p.quietStart === s && p.quietEnd === e,
      })),
      { label: '不设置', patch: { quietStart: 0, quietEnd: 0 }, match: (p) => p.quietStart === p.quietEnd },
    ],
  },
  silentFreeDay: {
    title: '没有课的一天',
    options: [
      { label: '不发任何通知', patch: { silentFreeDay: true }, match: (p) => p.silentFreeDay },
      { label: '照常提醒', patch: { silentFreeDay: false }, match: (p) => !p.silentFreeDay },
    ],
  },
}

function valueOf(key: PrefKey, p: Prefs): string {
  if (key === 'taskLeads') return p.taskLeads.length === 0 ? '不提醒' : [...p.taskLeads].sort((a, b) => b - a).map(leadLabel).join('、')
  const hit = OPTIONS[key].options.find((o) => o.match(p))
  return hit ? hit.label : '—'
}

const GROUPS: [string, PrefKey[]][] = [
  ['上课', ['classLead', 'firstClassLead', 'onlyChanged']],
  ['作业与考试', ['taskLeads', 'examDays']],
  ['变更', ['changePush', 'importSummary']],
  ['安静', ['muteInClass', 'quiet', 'silentFreeDay']],
]

export function NotifPrefPage({ onBack, onPick }: { onBack: () => void; onPick: (k: PrefKey) => void }) {
  const state = useStore()
  const [allowed, setAllowed] = useState(true)
  const [exact, setExact] = useState(true)

  useEffect(() => {
    void notificationsAllowed().then(setAllowed)
    void exactAlarmsAllowed().then(setExact)
  }, [])

  const tests: [string, string, () => Promise<void>][] = [
    ['立即发一条', '', async () => {
      const ok = await scheduleTestNotification()
      if (!ok) nativeToast('通知未开启')
    }],
    ['1 分钟后发一条', '锁屏等它', async () => {
      const ok = await scheduleTestNotification(new Date(Date.now() + 60_000))
      nativeToast(ok ? '1 分钟后弹出，可以锁屏等' : '通知未开启')
    }],
    ['横幅弹出', '只进状态栏不弹时去开', async () => {
      openChannelSettings(CHANNEL)
    }],
    ['电池不限制', '防止被系统杀后收不到', async () => {
      if (await requestIgnoreBattery()) nativeToast('已是不限制')
    }],
  ]

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none]">
        <TopBar title="通知" sub="上课前、作业截止前、课表变更时提醒。" onBack={onBack} />
        {!allowed && (
          <button
            onClick={async () => {
              const ok = await requestNotifications()
              setAllowed(ok)
              if (ok) void syncNotifications()
            }}
            className="mt-6 flex w-full items-center rounded-[18px] bg-(--c-surface) px-4 py-3.5 text-left transition-opacity active:opacity-60"
          >
            <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">系统通知未开启</span>
            <span className="text-[12.5px] font-bold text-(--c-accent)">开启</span>
          </button>
        )}
        {allowed && !exact && (
          <button
            onClick={async () => setExact(await requestExactAlarms())}
            className="mt-6 flex w-full items-center rounded-[18px] bg-(--c-surface) px-4 py-3.5 text-left transition-opacity active:opacity-60"
          >
            <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">提醒可能不准时</span>
            <span className="text-[12.5px] font-bold text-(--c-accent)">允许闹钟</span>
          </button>
        )}
        <div className="mt-5">
          {GROUPS.map(([g, keys]) => (
            <div key={g} className="mt-5 first:mt-0">
              <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">{g}</div>
              <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
                {keys.map((k, i) => (
                  <button
                    key={k}
                    onClick={() => onPick(k)}
                    className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
                  >
                    <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{OPTIONS[k].title}</span>
                    <span className="text-[12.5px] font-medium tabular-nums text-(--c-ink4)">{valueOf(k, state.prefs)}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.2" className="ml-2"><path d="m9 5 7 7-7 7" /></svg>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-5">
            <div className="px-0.5 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">测试</div>
            <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
              {tests.map(([title, sub, run], i) => (
                <button
                  key={title}
                  onClick={() => void run()}
                  className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
                >
                  <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">{title}</span>
                  {sub && <span className="text-[12.5px] font-medium text-(--c-ink4)">{sub}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}

export function PrefPickPage({ pref, onBack }: { pref: PrefKey; onBack: () => void }) {
  const state = useStore()
  const { title, sub, multi, options } = OPTIONS[pref]
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none]">
        <TopBar title={title} sub={sub} onBack={onBack} />
        <div className="mt-6 rounded-[18px] bg-(--c-surface) px-4">
          {options.map((o, i) => {
            const on = o.match(state.prefs)
            return (
              <button
                key={o.label}
                onClick={() => {
                  store.setPrefs(typeof o.patch === 'function' ? o.patch(state.prefs) : o.patch)
                  void syncNotifications()
                  if (!multi) onBack()
                }}
                className={`flex w-full items-center py-3.5 text-left transition-opacity active:opacity-60 ${i ? 'border-t border-(--c-surface2)' : ''}`}
              >
                <span className={`flex-1 text-[14px] font-semibold ${on && !multi ? 'text-(--c-accent)' : 'text-(--c-ink)'}`}>{o.label}</span>
                <Tick on={on} multi={multi} />
              </button>
            )
          })}
        </div>
      </div>
    </Page>
  )
}

/* ---------------- 桌面小组件 ---------------- */

function WCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[24px] bg-(--c-surface) p-3.5 shadow-[0_6px_20px_rgba(0,0,0,.10)] ${className}`}>{children}</div>
}

function WHead({ d, w, sub }: { d: string; w: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[30px] leading-none font-semibold tracking-[-.03em] tabular-nums text-(--c-ink)">{d}</span>
      <span className="text-[13px] font-semibold text-(--c-accent)">{w}</span>
      {sub && <span className="ml-auto text-[11.5px] font-semibold text-(--c-ink4)">{sub}</span>}
    </div>
  )
}

function WRow({ name, time, loc, color, big = true }: { name: string; time?: string; loc?: string; color: string; big?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] py-1.5 pr-2.5 pl-0" style={{ background: tint(color, 8) }}>
      <i className="my-[3px] ml-1.5 w-[3px] flex-none self-stretch rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className={`truncate ${big ? 'text-[13px]' : 'text-[12px]'} leading-[1.3] font-bold tracking-[-.01em] text-(--c-ink)`}>{name}</div>
        {loc && <div className="mt-[1px] truncate text-[11px] leading-[1.25] font-medium text-(--c-ink3)">{loc}</div>}
      </div>
      {time && <div className="flex-none text-right text-[11.5px] leading-[1.3] font-semibold tabular-nums text-(--c-ink3)">{time}</div>}
    </div>
  )
}


function Pick({ style, onAdd, children, className = '' }: { style: WidgetStyle; onAdd: (s: WidgetStyle) => void; children: React.ReactNode; className?: string }) {
  return (
    <button onClick={() => onAdd(style)} className={`text-left transition-transform active:scale-[.985] ${className}`}>
      {children}
    </button>
  )
}

export function WidgetPage({ snap, onBack }: { snap: Snapshot; onBack: () => void }) {
  const state = useStore()
  const [pinnable, setPinnable] = useState(false)

  useEffect(() => {
    void widgetPinSupported().then(setPinnable)
    void syncWidgets()
  }, [])

  const today = todayStr()
  const tomorrow = addDays(today, 1)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const list = useMemo(() => occurrencesOn(snap, today).filter((o) => o.status !== 'cancelled'), [snap, today])
  const tlist = useMemo(() => occurrencesOn(snap, tomorrow).filter((o) => o.status !== 'cancelled'), [snap, tomorrow])
  const week = Math.max(1, Math.min(snap.semester.totalWeeks, weekOf(snap.semester, today)))
  const cols = useMemo(
    () => [1, 2, 3, 4, 5].map((wd) => {
      const date = dateOf(snap.semester, week, wd)
      return { date, items: occurrencesOn(snap, date).filter((o) => o.status !== 'cancelled') }
    }),
    [snap, week],
  )
  const cur = list.find((o) => o.start <= nowMin && nowMin < o.end)
  const next = list.find((o) => o.start > nowMin) ?? tlist[0]
  const remain = list.filter((o) => o.end > nowMin)
  const left = remain.length
  const dayNum = String(Number(today.slice(8)))
  const wdName = WD[((new Date(`${today}T00:00`).getDay() + 6) % 7) + 1]

  const add = (style: WidgetStyle) => {
    store.setPrefs({ widgetStyle: style })
    void addWidgetToHome(style)
  }

  const preview = (style: WidgetStyle) => {
    switch (style) {
      case 'today':
        return (
          <WCard className="h-[162px] w-[162px]">
            <WHead d={dayNum} w={wdName} sub={left > 0 ? `还剩 ${left} 节` : '没有课了'} />
            <div className="mt-2.5 space-y-1.5">
              {remain.slice(0, 2).map((o) => (
                <WRow key={o.key} name={o.name} loc={o.location ?? undefined} time={fmtMinutes(o.start)} color={o.color} big={false} />
              ))}
            </div>
          </WCard>
        )
      case 'next':
        return (
          <WCard className="flex h-[162px] w-[162px] flex-col">
            <div className="text-[11.5px] font-bold text-(--c-ink3)">{cur ? '上课中' : '下一节'}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-[38px] leading-none font-semibold tracking-[-.035em] tabular-nums text-(--c-ink)">
                {cur ? Math.max(1, cur.end - nowMin) : next ? Math.max(1, next.start - nowMin) : '—'}
              </span>
              <span className="text-[13px] font-semibold text-(--c-ink3)">{cur ? '分钟后下课' : next ? '分钟后' : '没有课'}</span>
            </div>
            <div className="mt-auto">
              {(cur ?? next) && (
                <WRow
                  name={(cur ?? next)!.name}
                  loc={[(cur ?? next)!.location, (cur ?? next)!.teacher].filter(Boolean).join('　') || undefined}
                  color={(cur ?? next)!.color}
                  big={false}
                />
              )}
            </div>
          </WCard>
        )
      case 'twoDays':
        return (
          <WCard className="flex h-[162px] w-full gap-3.5">
            <div className="min-w-0 flex-1">
              <WHead d={dayNum} w={wdName} sub={left > 0 ? `还剩 ${left} 节` : '没有课了'} />
              <div className="mt-2.5 space-y-1.5">
                {remain.slice(0, 2).map((o) => (
                  <WRow key={o.key} name={o.name} time={fmtMinutes(o.start)} color={o.color} big={false} />
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-(--c-ink4)">明天{tlist.length > 0 ? ` ${tlist.length} 节` : '没有课'}</div>
              <div className="mt-2.5 space-y-1.5">
                {tlist.slice(0, 2).map((o) => (
                  <WRow key={o.key} name={o.name} time={fmtMinutes(o.start)} color={o.color} big={false} />
                ))}
              </div>
            </div>
          </WCard>
        )
      case 'week':
        return (
          <WCard className="w-full px-3.5 pt-3.5 pb-4">
            <div className="flex items-baseline">
              <span className="text-[17px] font-semibold tracking-[-.02em] text-(--c-ink)">第 {week} 周</span>
              <span className="ml-2 text-[12px] font-semibold text-(--c-ink4)">{Number(today.slice(5, 7))}月{dayNum}日</span>
            </div>
            <div className="mt-3 flex gap-1.5">
              {[1, 2, 3, 4, 5].map((wd) => (
                <div key={wd} className={`flex-1 text-center text-[11.5px] font-bold ${cols[wd - 1].date === today ? 'text-(--c-accent)' : 'text-(--c-ink3)'}`}>{WD[wd]}</div>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {cols.map((col) => (
                <div key={col.date} className="flex flex-1 flex-col gap-1.5">
                  {col.items.slice(0, 2).map((o) => {
                    const isNow = col.date === today && o.start <= nowMin && nowMin < o.end
                    return (
                      <div
                        key={o.key}
                        className="h-[64px] rounded-[10px] px-1.5 py-2"
                        style={{ background: tint(o.color, isNow ? 16 : 8), boxShadow: isNow ? `inset 0 0 0 1.5px ${o.color}` : undefined }}
                      >
                        <div className="truncate text-[11px] leading-[1.25] font-bold" style={{ color: `color-mix(in srgb, ${o.color} 88%, var(--c-ink))` }}>{o.name}</div>
                        <div className="mt-1.5 text-[10px] leading-[1.3] font-semibold tabular-nums text-(--c-ink3)">{fmtMinutes(o.start)}</div>
                        <div className="mt-[1px] truncate text-[10px] leading-[1.3] font-medium text-(--c-ink4)">{o.location ?? ''}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </WCard>
        )
    }
  }

  return (
    <Page className="bg-[#5d6d55]">
      <img src="/wall.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
      <div className="absolute inset-0 bg-black/25" />
      <StickyHead bleed={0} className="relative z-[30] px-5 pb-1">
        <div className="flex h-9 items-center">
          <BackButton onClick={onBack} />
        </div>
      </StickyHead>
      <div className="relative flex-1 overflow-y-auto px-4 pb-[130px] [scrollbar-width:none]">
        <h1 className="px-1 text-[26px] font-extrabold tracking-[-.02em] text-white">桌面小组件</h1>
        <div className="mt-5">
          <div className="flex gap-3.5">
            <Pick style="today" onAdd={add}>{preview('today')}</Pick>
            <Pick style="next" onAdd={add}>{preview('next')}</Pick>
          </div>
          <Pick style="twoDays" onAdd={add} className="mt-3.5 block w-full">{preview('twoDays')}</Pick>
          <Pick style="week" onAdd={add} className="mt-3.5 block w-full">{preview('week')}</Pick>
        </div>
      </div>
    </Page>
  )
}

export type { PrefKey }
