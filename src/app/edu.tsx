import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import type { NormalizedCourse, RuleOutput } from '../domain/importer'
import type { RuleManifest } from '../domain/rules'
import { parseHtml } from '../domain/importers/html'
import { SYSTEM_LABEL, detectSystem, hostOf, isTimetablePage, scrubUrl, type EduSystemId } from '../domain/edu/systems'
import { schoolByUrl, searchSchools, urlFromQuery, type School } from '../domain/edu/schools'
import { zfTermOptions, type ProbeResult } from '../domain/edu/scripts'
import { parseZfKbList, termLabel, type ZfTerm } from '../domain/edu/zhengfang'
import { LATEST_RELEASE_API, RELEASES_URL, isNewer, issueUrl } from '../domain/edu/release'
import { edu, nativeEdu, type EduNav } from './edu-browser'
import { haptic, nativeToast } from './widgets'
import { BackButton, Loader, Page, PrimaryButton, Row, SLIDE, Sheet, SheetClose, SheetHead, TopBar, dockStyle, tint } from './ui'

/* 教务导入：选学校 → 内置浏览器里自己登录、打开课表页 → 读当前页 → 预览（复用 ImportRunPage）。
   浏览器会话独立，离开时清掉；只在用户点「导入」后读取当前页面 / 同源课表接口。 */

/** 预览页用的规则对象；不进 BUILTIN_RULES，规则列表里不出现 */
export const EDU_RULE: RuleManifest = { id: 'builtin-edu', name: '教务系统', version: '1.0', input: 'json', createdAt: 0, updatedAt: 0 }

export interface EduFailInfo {
  url: string
  system: EduSystemId | null
  /** 点导入时页面的正文文字；给「让 AI 转换」用 */
  text: string
}

/* ---------------- 最近使用 ---------------- */

const RECENT_KEY = 'tt.edu.recent'
const RECENT_MAX = 5

function isSchool(x: unknown): x is School {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.name === 'string' && typeof o.url === 'string' && (o.system === null || typeof o.system === 'string')
}

function loadRecent(): School[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(isSchool) : []
  } catch {
    return []
  }
}

function rememberSchool(s: School) {
  const list = [s, ...loadRecent().filter((x) => x.url !== s.url)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* 忽略 */
  }
}

/** 系统浏览器打开外链（GitHub）。原生壳里非本站地址由 Capacitor 转交系统浏览器 */
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener')
}

const systemText = (s: EduSystemId | null) => (s ? SYSTEM_LABEL[s] : '网页')

function Chevron() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink5)' }} strokeWidth="2.4" strokeLinecap="round" className="flex-none"><path d="m9 5 7 7-7 7" /></svg>
  )
}

function SchoolRow({ s, onClick }: { s: School; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center px-4 py-3.5 text-left transition-colors active:bg-(--c-bg)">
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-(--c-ink)">{s.name}</span>
      <span className="mr-2.5 flex-none text-[12px] font-medium text-(--c-ink4)">{systemText(s.system)}</span>
      <Chevron />
    </button>
  )
}

/* ---------------- 选择学校 ---------------- */

export function EduSchoolPage({ onBack, onOpen }: { onBack: () => void; onOpen: (school: School) => void }) {
  const [q, setQ] = useState('')
  const [recent] = useState<School[]>(loadRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const typing = q.trim() !== ''
  const results = useMemo(() => searchSchools(q), [q])
  const url = urlFromQuery(q)
  const direct = useMemo<School | null>(() => (url ? (schoolByUrl(url) ?? { name: hostOf(url), system: null, url }) : null), [url])
  const list = typing ? [...(direct ? [direct] : []), ...results.filter((s) => s.url !== direct?.url)] : recent

  const pick = (s: School) => {
    rememberSchool(s)
    onOpen(s)
  }

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-10 [scrollbar-width:none]">
        <TopBar title="选择学校" onBack={onBack} />

        <div className="mt-6 flex h-[44px] items-center rounded-[14px] bg-(--c-surface) px-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink4)' }} strokeWidth="2.4" strokeLinecap="round" className="mr-2.5 flex-none"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) pick(list[0])
            }}
            placeholder="学校名或教务网址"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14.5px] font-semibold text-(--c-ink) outline-none placeholder:font-medium placeholder:text-(--c-ink4)"
          />
          {typing && (
            <button onClick={() => { setQ(''); inputRef.current?.focus() }} className="ml-2 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-(--c-surface2)">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink3)' }} strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>

        {!typing && recent.length > 0 && <div className="mt-6 text-[12.5px] font-semibold text-(--c-ink3)">最近</div>}
        {list.length > 0 && (
          <div className={`${typing ? 'mt-4' : 'mt-2.5'} divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)`}>
            {list.map((s) => <SchoolRow key={s.url} s={s} onClick={() => pick(s)} />)}
          </div>
        )}
        {typing && list.length === 0 && (
          <div className="mt-8 text-center text-[13px] font-medium text-(--c-ink4)">没有匹配的学校，可直接输入教务网址</div>
        )}
      </div>
    </Page>
  )
}

/* ---------------- 选学期（正方） ---------------- */

function EduTermSheet({ zf, onClose, onPick }: { zf: NonNullable<ProbeResult['zf']>; onClose: () => void; onPick: (t: ZfTerm) => void }) {
  const dismiss = useRef<(() => void) | null>(null)
  const options = useMemo(() => zfTermOptions(zf), [zf])
  const [sel, setSel] = useState<ZfTerm>(() => options.find((t) => t.xnm === zf.sel.xnm && t.xqm === zf.sel.xqm) ?? options[0] ?? zf.sel)
  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-5 pb-1"
      header={<SheetHead title="导入哪个学期？" trail={<SheetClose onClick={() => dismiss.current?.()} />} />}
      footer={
        <div className="px-5 pt-2">
          <PrimaryButton onClick={() => { onPick(sel); dismiss.current?.() }}>继续</PrimaryButton>
        </div>
      }
    >
      <div className="space-y-2 pt-1">
        {options.map((t) => {
          const on = t.xnm === sel.xnm && t.xqm === sel.xqm
          return (
            <button
              key={`${t.xnm}-${t.xqm}`}
              onClick={() => { haptic('selection'); setSel(t) }}
              className="flex w-full items-center rounded-[12px] px-3.5 py-3 text-left"
              style={{ background: on ? 'var(--c-accent-soft)' : 'var(--c-row-muted)', boxShadow: on ? 'inset 0 0 0 1.5px var(--c-accent)' : undefined }}
            >
              <span className="mr-3 flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-[1.8px]" style={{ borderColor: on ? 'var(--c-accent)' : 'var(--c-radio-border)', background: on ? 'var(--c-accent)' : 'transparent' }}>
                {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6"><path d="m6 12.5 4 4 8-9" /></svg>}
              </span>
              <span className={`text-[13.5px] font-bold text-(--c-ink) ${on ? '' : 'opacity-55'}`}>{termLabel(t)}</span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

/* ---------------- 内置浏览器 ---------------- */

/** 系统返回键：先让页面自己后退，退不了再离开 */
export const eduBack: { current: (() => Promise<void>) | null } = { current: null }

type Ready =
  | { kind: 'none' }
  | { kind: 'table' }
  | { kind: 'zf'; zf: NonNullable<ProbeResult['zf']>; count: number | null }

const HTML_CLASS = 'tt-edu'

export function EduBrowserPage({ school, onBack, onImport, onFail }: {
  school: School
  onBack: () => void
  onImport: (out: RuleOutput) => void
  onFail: (info: EduFailInfo) => void
}) {
  const native = nativeEdu()
  const [nav, setNav] = useState<EduNav>({ url: school.url, title: '', loading: native, progress: 0, canGoBack: false })
  const [ready, setReady] = useState<Ready>({ kind: 'none' })
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(false)
  const hole = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const left = useRef(false)

  const sys = detectSystem(nav.url, school.system)
  const onPage = !nav.loading && !nav.error && isTimetablePage(sys, nav.url, nav.title)
  const can = !nav.error && ready.kind !== 'none'
  const showPill = can || !!nav.error

  /* 推入动画结束后再打开原生页面并把应用切透明，避免动画过程露底 */
  useEffect(() => {
    const off = edu.onNav(setNav)
    const t = window.setTimeout(() => {
      document.documentElement.classList.add(HTML_CLASS)
      void edu.open(school.url)
      setOpened(true)
    }, SLIDE.duration * 1000 + 40)
    return () => {
      window.clearTimeout(t)
      off()
      document.documentElement.classList.remove(HTML_CLASS)
      void edu.close()
    }
  }, [school.url])

  /* 透明洞与悬浮胶囊的矩形交给原生：洞里触摸给学校页面，胶囊留给自己；抽屉打开时整页不透传 */
  useEffect(() => {
    if (!opened) return
    const h = hole.current
    const p = pill.current
    if (!h) return
    const send = () => {
      const a = h.getBoundingClientRect()
      const b = p?.getBoundingClientRect()
      void edu.frame({
        top: a.top,
        bottom: Math.max(0, window.innerHeight - a.bottom),
        keep: b ? [{ x: b.left, y: b.top, w: b.width, h: b.height }] : [],
        interactive: !sheet,
      })
    }
    send()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(send)
    ro.observe(h)
    if (p) ro.observe(p)
    return () => ro.disconnect()
  }, [opened, sheet, showPill])

  /* 还没到课表页时不摆胶囊，首次加载完成后用一条 toast 提示去向 */
  const hinted = useRef(false)
  useEffect(() => {
    if (hinted.current || !opened || nav.loading || nav.error || onPage) return
    hinted.current = true
    nativeToast('登录后打开课表页')
  }, [opened, nav.loading, nav.error, onPage])

  /* 到了课表页：探测页面结构；正方再按当前学期取一次课程数给胶囊 */
  const probed = useRef('')
  useEffect(() => {
    if (!onPage) {
      probed.current = ''
      setReady({ kind: 'none' })
      return
    }
    if (probed.current === nav.url) return
    probed.current = nav.url
    let alive = true
    void (async () => {
      try {
        const p = await edu.probe()
        if (!alive) return
        if (p.zf && sys === 'zhengfang_new') {
          setReady({ kind: 'zf', zf: p.zf, count: null })
          const list = await edu.zfFetch(p.zf.sel.xnm, p.zf.sel.xqm)
          if (alive) setReady({ kind: 'zf', zf: p.zf, count: parseZfKbList(list).courses.length })
        } else {
          setReady(p.table ? { kind: 'table' } : { kind: 'none' })
        }
      } catch {
        if (alive) setReady({ kind: 'none' })
      }
    })()
    return () => {
      alive = false
    }
  }, [onPage, nav.url, sys])

  const leave = useCallback(async () => {
    if (left.current) return
    left.current = true
    document.documentElement.classList.remove(HTML_CLASS)
    await edu.close()
  }, [])
  const goBack = useCallback(async () => {
    await leave()
    onBack()
  }, [leave, onBack])

  useEffect(() => {
    eduBack.current = async () => {
      const { went } = await edu.back()
      if (!went) await goBack()
    }
    return () => {
      eduBack.current = null
    }
  }, [goBack])

  const fail = async () => {
    let text = ''
    try {
      text = await edu.pageText()
    } catch {
      /* 页面读不到正文：AI 转换项不显示 */
    }
    await leave()
    onFail({ url: nav.url, system: sys, text })
  }

  const finish = async (out: RuleOutput) => {
    if (out.courses.length === 0) return fail()
    haptic('success')
    await leave()
    onImport(out)
  }

  const importGeneric = async () => {
    setBusy(true)
    try {
      const html = await edu.pageHtml()
      await finish(parseHtml(html, { mode: 'grid' }))
    } catch {
      await fail()
    } finally {
      setBusy(false)
    }
  }

  const importZf = async (t: ZfTerm) => {
    setBusy(true)
    try {
      const list = await edu.zfFetch(t.xnm, t.xqm)
      await finish({ ...parseZfKbList(list), semester: { name: termLabel(t) } })
    } catch {
      await fail()
    } finally {
      setBusy(false)
    }
  }

  const onImportTap = () => {
    if (busy || ready.kind === 'none') return
    if (ready.kind === 'zf') setSheet(true)
    else void importGeneric()
  }

  const label = nav.error === 'ssl'
    ? '证书错误，无法打开'
    : nav.error
      ? '页面打不开'
      : ready.kind === 'zf' && ready.count !== null
        ? `导入 ${ready.count} 门课`
        : '导入课表'
  const secure = /^https:/i.test(nav.url)

  return (
    <Page keep>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* 顶栏自己铺底色：下面的学校页面多为白底，胶囊不能直接压在上面 */}
        <div className="flex items-center gap-3 bg-(--c-bg) px-5 pt-[max(52px,calc(env(safe-area-inset-top)+22px))] pb-4">
          <BackButton onClick={() => void goBack()} />
          <div className="flex h-9 min-w-0 flex-1 items-center rounded-full bg-(--c-surface) px-4">
            {secure && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink4)' }} strokeWidth="2.4" className="mr-2 flex-none"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-(--c-ink2)">{hostOf(nav.url)}</span>
            {nav.loading && <Loader size={12} className="ml-2 flex-none text-(--c-ink4)" />}
          </div>
          <button onClick={() => void edu.reload()} className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-(--c-surface) transition-transform duration-150 active:scale-[.92]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink)' }} strokeWidth="2.4" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
          </button>
        </div>

        {/* 透明洞：原生 WebView 在下面显示学校页面 */}
        <div ref={hole} className="flex flex-1 items-center justify-center">
          {!native && (
            <div className="rounded-[14px] bg-(--c-surface) px-4 py-2.5 text-[12.5px] font-medium text-(--c-ink4)">内置浏览器仅在应用内可用</div>
          )}
        </div>

        {showPill && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(36px,calc(env(safe-area-inset-bottom)+20px))] z-[9] flex justify-center">
          <button
            ref={pill}
            onClick={onImportTap}
            disabled={!can || busy}
            className={`pointer-events-auto flex h-[36px] items-center gap-1.5 rounded-full px-4 text-[13px] font-bold transition-transform duration-150 active:scale-[.97] ${can ? 'text-(--c-accent)' : 'text-(--c-ink3)'}`}
            style={dockStyle}
          >
            {busy && <Loader size={13} />}
            {label}
          </button>
        </div>
        )}

        {sheet && ready.kind === 'zf' && (
          <EduTermSheet zf={ready.zf} onClose={() => setSheet(false)} onPick={(t) => void importZf(t)} />
        )}
      </div>
    </Page>
  )
}

/* ---------------- 预览缩略图 ---------------- */

const GRID_H = 152

/** 一周课表缩略图：按节次比例放色块，只看分布不看字 */
export function PreviewGrid({ courses, periods }: { courses: NormalizedCourse[]; periods: number }) {
  const days = courses.some((c) => c.rules.some((r) => r.weekday === 7)) ? 7 : courses.some((c) => c.rules.some((r) => r.weekday === 6)) ? 6 : 5
  const n = Math.max(1, periods)
  const cols = Array.from({ length: days }, (_, i) => i + 1)
  const marks = [0.25, 0.5, 0.75].map((f) => Math.round(GRID_H * f))
  return (
    <div className="rounded-[16px] bg-(--c-surface) px-3 pt-2.5 pb-3">
      <div className="flex gap-[4px]">
        {cols.map((d) => <div key={d} className="flex-1 text-center text-[9.5px] font-semibold text-(--c-ink4)">{'一二三四五六日'[d - 1]}</div>)}
      </div>
      <div className="relative mt-1.5 flex gap-[4px]" style={{ height: GRID_H }}>
        {marks.map((t) => <div key={t} className="absolute inset-x-0 h-px bg-(--c-line2)" style={{ top: t }} />)}
        {cols.map((d) => (
          <div key={d} className="relative flex-1">
            {courses.flatMap((c) =>
              c.rules.filter((r) => r.weekday === d).map((r, i) => (
                <div
                  key={`${c.course.identityKey}-${i}`}
                  className="absolute inset-x-0 overflow-hidden rounded-[5px] px-1 py-[3px] text-[7.5px] leading-[1.25] font-bold"
                  style={{
                    top: ((r.startPeriod - 1) / n) * GRID_H,
                    height: Math.max(6, ((r.endPeriod - r.startPeriod + 1) / n) * GRID_H - 1),
                    background: tint(c.course.color, 14),
                    color: `color-mix(in srgb, ${c.course.color} 88%, var(--c-ink-mix))`,
                  }}
                >
                  {c.course.name}
                </div>
              )),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 未识别 ---------------- */

async function appVersion(): Promise<string> {
  try {
    return (await CapApp.getInfo()).version
  } catch {
    return ''
  }
}

async function latestRelease(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const j: unknown = await res.json()
    if (typeof j !== 'object' || j === null) return null
    const o = j as Record<string, unknown>
    if (typeof o.tag_name !== 'string') return null
    return { tag: o.tag_name, url: typeof o.html_url === 'string' ? o.html_url : RELEASES_URL }
  } catch {
    return null
  }
}

export function EduFailPage({ info, onBack, onAi }: { info: EduFailInfo; onBack: () => void; onAi: (text: string) => void }) {
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [v, latest] = await Promise.all([appVersion(), latestRelease()])
      if (!alive) return
      setVersion(v)
      if (latest && v && isNewer(latest.tag, v)) setUpdate(latest.url)
    })()
    return () => {
      alive = false
    }
  }, [])

  const text = info.text.trim()
  return (
    <Page>
      <div className="flex flex-1 flex-col overflow-hidden px-5">
        <div className="flex-1 overflow-y-auto pb-6 [scrollbar-width:none]">
          <TopBar title="没有识别到课表" onBack={onBack} />

          <div className="mt-6 rounded-[16px] bg-(--c-surface) px-4 py-3.5">
            <div className="text-[11.5px] font-semibold text-(--c-ink4)">页面</div>
            <div className="mt-1.5 truncate font-mono text-[12.5px] text-(--c-ink)">{scrubUrl(info.url).replace(/^https?:\/\//, '')}</div>
            {info.system && <div className="mt-1 text-[11.5px] font-medium text-(--c-ink4)">{SYSTEM_LABEL[info.system]}</div>}
          </div>

          <div className="mt-6 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
            {text && <Row title="让 AI 转换" desc="把页面文字连同 Prompt 交给 AI" onClick={() => onAi(text)} />}
            {update && <Row title="更新到最新版本" desc="新版本可能已支持这个页面" onClick={() => openExternal(update)} />}
            <Row title="反馈这个页面" desc="只提交页面地址、系统猜测和版本号" onClick={() => openExternal(issueUrl({ url: info.url, system: info.system, version }))} />
          </div>
        </div>

        <div className="flex-none pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
          <button onClick={onBack} className="w-full rounded-[18px] bg-(--c-surface) py-[15px] text-[15px] font-bold text-(--c-ink) transition-transform duration-150 active:scale-[.985]">返回</button>
        </div>
      </div>
    </Page>
  )
}
