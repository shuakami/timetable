import React, { useMemo, useRef, useState } from 'react'
import type { Semester } from '../domain/types'
import { fmtMinutes } from '../domain/dates'
import {
  BREAK_MAX, DURATION_STEP, MAX_DURATION, MAX_PERIODS, MIN_DURATION, MIN_PERIODS,
  breakBefore, commonBreak, draftFromGrid, endOf, gridFromDraft, invalidPeriods,
  resetEnd, setCommonBreak, setCount, setDuration, setEnd, setGapBefore, setStart, type ScheduleDraft,
} from '../domain/schedule'
import { store } from './store'
import { nativeConfirm } from './widgets'
import { Field, Page, PrimaryButton, Row, Sheet, SheetClose, SheetHead, Stepper, Switch, TextInput, TimeWheels, TopBar } from './ui'

/* 作息时间：与原型 ScheduleScreen 逐屏一致 */

const gapText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`)
const breakName = (start: number) => (start < 15 * 60 ? '午休' : start < 20 * 60 ? '晚饭' : '休息')

type Pick = { i: number; which: 'start' | 'end' }

/** 节次行：序号 26 | 开始胶囊 | 箭头 | 下课胶囊 | 时长，两个胶囊平分余宽 */
const COL_IDX = 'w-[26px] flex-none'
const COL_DUR = 'ml-3 w-[46px] flex-none text-right'

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--c-ink4)' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-2 flex-none">
      <path d="M4 12h16M14 6l6 6-6 6" />
    </svg>
  )
}

export function SchedulePage({ sem, onBack, onGrids, gridId }: {
  sem: Semester
  onBack: () => void
  /** 进入作息制列表；编辑某套作息制时不传 */
  onGrids?: () => void
  /** 编辑的作息制 id；不传编辑默认节次表 */
  gridId?: string
}) {
  const named = gridId ? sem.grids?.find((g) => g.id === gridId) : undefined
  const source = named?.timeGrid ?? sem.timeGrid
  const [d, setD] = useState<ScheduleDraft>(() => draftFromGrid(source))
  const [name, setName] = useState(named?.name ?? '')
  const [fromW, setFromW] = useState(named?.fromWeek ?? 1)
  const [toW, setToW] = useState(named?.toWeek ?? sem.totalWeeks)
  const [pick, setPick] = useState<Pick | null>(null)
  const [gapPick, setGapPick] = useState<number | null>(null)
  const bad = useMemo(() => new Set(invalidPeriods(d)), [d])
  const n = d.starts.length
  const common = useMemo(() => commonBreak(d), [d])
  const gridDirty = useMemo(() => JSON.stringify(gridFromDraft(d)) !== JSON.stringify(source), [d, source])
  const metaDirty = !!named && (name.trim() !== named.name || fromW !== named.fromWeek || toW !== named.toWeek)
  const rangeOk = !named || (fromW >= 1 && toW <= sem.totalWeeks && fromW <= toW)
  const dirty = gridDirty || metaDirty

  const save = () => {
    const timeGrid = gridFromDraft(d)
    if (named) {
      const grids = (sem.grids ?? []).map((g) =>
        g.id === named.id
          ? { ...g, name: name.trim() || '未命名', fromWeek: fromW, toWeek: toW, timeGrid }
          : g,
      )
      store.setSemester({ ...sem, grids })
    } else {
      store.setSemester({ ...sem, timeGrid })
    }
    onBack()
  }

  const del = async () => {
    if (!named) return
    const ok = await nativeConfirm({ title: `删除「${named.name || '未命名'}」`, message: '对应周次改用默认作息', ok: '删除' })
    if (!ok) return
    store.setSemester({ ...sem, grids: (sem.grids ?? []).filter((g) => g.id !== named.id) })
    onBack()
  }

  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none]">
        <TopBar title={named ? '作息制' : '作息时间'} sub={named ? `${name.trim() || '未命名'}，第 ${fromW}–${toW} 周` : undefined} onBack={onBack} />

        {named && (
          <div className="mt-6 divide-y divide-(--c-surface2) overflow-hidden rounded-[18px] bg-(--c-surface)">
            <Field k="名称"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 夏令时" /></Field>
            <Field k="开始周"><TextInput type="number" min={1} max={sem.totalWeeks} value={fromW} onChange={(e) => setFromW(Number(e.target.value))} /></Field>
            <Field k="结束周"><TextInput type="number" min={1} max={sem.totalWeeks} value={toW} onChange={(e) => setToW(Number(e.target.value))} /></Field>
          </div>
        )}

        <div className={`rounded-[18px] bg-(--c-surface) px-4 ${named ? 'mt-3' : 'mt-6'}`}>
          <div className="flex items-center py-3">
            <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">总节数</span>
            <Stepper value={n} unit="节" min={MIN_PERIODS} max={MAX_PERIODS} onChange={(v) => setD(setCount(d, v))} />
          </div>
          <div className="flex items-center border-t border-(--c-line2) py-3">
            <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">标准时长</span>
            <Stepper value={d.duration} unit="分" min={MIN_DURATION} max={MAX_DURATION} step={DURATION_STEP} onChange={(v) => setD(setDuration(d, v))} />
          </div>
          {common != null && (
            <div className="flex items-center border-t border-(--c-line2) py-3">
              <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">课间</span>
              <Stepper value={common} unit="分" min={0} max={BREAK_MAX - 5} step={5} onChange={(v) => setD(setCommonBreak(d, v))} />
            </div>
          )}
        </div>

        {onGrids && (
          <div className="mt-3 overflow-hidden rounded-[18px] bg-(--c-surface)">
            <Row
              title="作息制"
              desc={`${(sem.grids?.length ?? 0) + 1} 套`}
              onClick={onGrids}
            />
          </div>
        )}

        <div className="mt-5 flex items-baseline px-0.5">
          <span className="flex-1 text-[12px] font-bold tracking-[-.01em] text-(--c-ink5)">节次</span>
        </div>
        <div className="mt-2 rounded-[18px] bg-(--c-surface) px-4">
          <div className="flex items-center pt-3 pb-1 text-[11px] font-semibold text-(--c-ink5)">
            <span className={COL_IDX} />
            <span className="flex-1 text-center">开始</span>
            <span className="mx-2 w-[16px] flex-none" />
            <span className="flex-1 text-center">下课</span>
            <span className={COL_DUR}>时长</span>
          </div>
          {d.starts.map((s, i) => {
            const e = endOf(d, i)
            const custom = d.ends[i] != null
            const gap = breakBefore(d, i)
            const big = gap >= 60
            const wrong = bad.has(i)
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <button
                    onClick={() => setGapPick(i)}
                    className={`flex w-full items-center ${big ? 'h-[30px]' : 'h-[18px]'} transition-opacity active:opacity-60`}
                  >
                    <span className={COL_IDX} />
                    <span className={`flex-1 border-t border-dashed ${big ? 'border-(--c-line)' : 'border-(--c-line2)'}`} />
                    <span className={`px-2 text-[11px] font-semibold tabular-nums ${gap < 0 ? 'text-(--c-danger)' : big ? 'text-(--c-ink4)' : 'text-(--c-ink5)'}`}>
                      {gap < 0 ? `重叠 ${gapText(-gap)}` : `${big ? `${breakName(s)} ` : ''}${gapText(gap)}`}
                    </span>
                    <span className={`flex-1 border-t border-dashed ${big ? 'border-(--c-line)' : 'border-(--c-line2)'}`} />
                  </button>
                )}
                <div className="flex items-center py-1.5">
                  <span className={`${COL_IDX} text-[12.5px] font-bold tabular-nums text-(--c-ink4)`}>{i + 1}</span>
                  <button
                    onClick={() => setPick({ i, which: 'start' })}
                    className={`flex-1 rounded-[10px] bg-(--c-surface2) py-1.5 text-center text-[15px] font-bold tabular-nums transition-transform duration-150 active:scale-[.96] ${wrong ? 'text-(--c-danger)' : 'text-(--c-ink)'}`}
                  >
                    {fmtMinutes(s)}
                  </button>
                  <ArrowIcon />
                  <button
                    onClick={() => setPick({ i, which: 'end' })}
                    className={`flex-1 rounded-[10px] py-1.5 text-center text-[15px] tabular-nums transition-transform duration-150 active:scale-[.96] ${custom ? 'font-bold text-(--c-ink)' : 'font-medium text-(--c-ink4)'}`}
                    style={custom ? { boxShadow: 'inset 0 0 0 1.5px var(--c-accent)' } : undefined}
                  >
                    {fmtMinutes(e)}
                  </button>
                  <span className={`${COL_DUR} text-[12px] font-semibold tabular-nums ${custom ? 'text-(--c-accent)' : 'text-(--c-ink5)'}`}>{e - s} 分</span>
                </div>
              </React.Fragment>
            )
          })}
          <div className="h-2" />
        </div>

        {named && (
          <div className="mt-5 overflow-hidden rounded-[18px] bg-(--c-surface)">
            <Row title="删除这套作息制" danger onClick={del} right={<span />} />
          </div>
        )}
      </div>

      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton disabled={!dirty || !rangeOk || bad.size > 0} onClick={save}>保存</PrimaryButton>
      </div>

      {pick && (
        <ScheduleTimeSheet
          draft={d}
          pick={pick}
          onApply={(next) => setD(next)}
          onClose={() => setPick(null)}
        />
      )}
      {gapPick != null && (
        <GapSheet
          draft={d}
          i={gapPick}
          onApply={(next) => setD(next)}
          onClose={() => setGapPick(null)}
        />
      )}
    </Page>
  )
}

/** 作息制列表：默认作息管没排到其他作息制的周次；每套可命名、定周次区间 */
export function GridsPage({ sem, onBack, onEdit, onAdd }: {
  sem: Semester
  onBack: () => void
  onEdit: (id: string | null) => void
  onAdd: () => void
}) {
  const grids = sem.grids ?? []
  return (
    <Page>
      <div className="flex-1 overflow-y-auto px-5 pb-[130px] [scrollbar-width:none]">
        <TopBar title="作息制" sub={`${grids.length + 1} 套`} onBack={onBack} />
        <div className="mt-6 divide-y divide-(--c-surface2) overflow-hidden rounded-[18px] bg-(--c-surface)">
          <Row title="默认作息" desc="其余周次" onClick={() => onEdit(null)} />
          {grids.map((g) => (
            <Row key={g.id} title={g.name || '未命名'} desc={`第 ${g.fromWeek}–${g.toWeek} 周`} onClick={() => onEdit(g.id)} />
          ))}
        </div>
      </div>
      <div className="flex-none px-5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton onClick={onAdd}>添加作息制</PrimaryButton>
      </div>
    </Page>
  )
}

/** 改某节前的课间：分钟步进；之后的节次可选整体平移 */
function GapSheet({ draft, i, onApply, onClose }: { draft: ScheduleDraft; i: number; onApply: (d: ScheduleDraft) => void; onClose: () => void }) {
  const dismiss = useRef<(() => void) | null>(null)
  const gap0 = breakBefore(draft, i)
  const [m, setM] = useState(() => Math.max(0, gap0))
  /* 上限至少容纳现有课间，避免超长课间无法调小 */
  const [maxM] = useState(() => Math.max(180, Math.ceil(gap0 / 5) * 5))
  const [shift, setShift] = useState(true)
  const preview = setGapBefore(draft, i, m, shift)
  const last = draft.starts.length - 1
  /* 长课间才带午休 / 晚饭的名字，短课间只显示分钟 */
  const name = m >= BREAK_MAX ? breakName(preview.starts[i]) : ''
  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-5 pb-1"
      header={
        <SheetHead
          title={`第 ${i + 1} 节前课间`}
          sub={`${name ? `${name} ` : ''}${gapText(m)}`}
          trail={<SheetClose onClick={() => dismiss.current?.()} />}
        />
      }
      footer={
        <div className="px-5 pt-2">
          <PrimaryButton onClick={() => { onApply(preview); dismiss.current?.() }}>确定</PrimaryButton>
        </div>
      }
    >
      <div className="flex items-center justify-center py-3">
        <Stepper value={m} unit="分" min={0} max={maxM} step={5} onChange={setM} />
      </div>
      {i < last && (
        <div className="mt-1 flex items-center rounded-[14px] bg-(--c-row-muted) px-3.5 py-3">
          <span className="flex-1 text-[13.5px] font-semibold text-(--c-ink)">后续节次同步平移</span>
          <Switch on={shift} onChange={setShift} />
        </div>
      )}
    </Sheet>
  )
}

/** 改某节开始 / 下课：时:分滚轮；改开始时可选「后续节次同步平移」；改过的下课可恢复标准时长 */
function ScheduleTimeSheet({ draft, pick, onApply, onClose }: { draft: ScheduleDraft; pick: Pick; onApply: (d: ScheduleDraft) => void; onClose: () => void }) {
  const dismiss = useRef<(() => void) | null>(null)
  const { i, which } = pick
  const [m, setM] = useState(which === 'start' ? draft.starts[i] : endOf(draft, i))
  const [shift, setShift] = useState(true)
  const isStart = which === 'start'
  const preview = isStart ? setStart(draft, i, m, shift) : setEnd(draft, i, m)
  const last = draft.starts.length - 1
  const custom = draft.ends[i] != null
  const sub = isStart
    ? `${fmtMinutes(preview.starts[i])} – ${fmtMinutes(endOf(preview, i))}`
    : `${fmtMinutes(draft.starts[i])} – ${fmtMinutes(endOf(preview, i))}`
  return (
    <Sheet
      onClose={onClose}
      dismissRef={dismiss}
      className="px-5 pb-1"
      header={<SheetHead title={`第 ${i + 1} 节 ${isStart ? '开始' : '下课'}`} sub={sub} trail={<SheetClose onClick={() => dismiss.current?.()} />} />}
      footer={
        <div className="px-5 pt-2">
          <PrimaryButton onClick={() => { onApply(preview); dismiss.current?.() }}>确定</PrimaryButton>
        </div>
      }
    >
      <TimeWheels minutes={m} onChange={setM} step={5} className="py-3" />
      {isStart && i < last && (
        <div className="mt-1 flex items-center rounded-[14px] bg-(--c-row-muted) px-3.5 py-3">
          <span className="flex-1 text-[13.5px] font-semibold text-(--c-ink)">后续节次同步平移</span>
          <Switch on={shift} onChange={setShift} />
        </div>
      )}
      {!isStart && custom && (
        <div className="mt-1 flex items-center rounded-[14px] bg-(--c-row-muted) px-3.5 py-3">
          <span className="flex-1 text-[13.5px] font-semibold text-(--c-ink)">标准时长 {draft.duration} 分</span>
          <button onClick={() => { onApply(resetEnd(draft, i)); dismiss.current?.() }} className="text-[13px] font-bold text-(--c-accent) transition-opacity active:opacity-60">
            恢复
          </button>
        </div>
      )}
    </Sheet>
  )
}
