import { useMemo, useState, type MutableRefObject } from 'react'
import { AnimatePresence } from 'motion/react'
import { diffDays, fmtMinutes } from '../domain/dates'
import { DEFAULT_DURATION, DURATION_STEP, MAX_DURATION, MAX_PERIODS, MIN_DURATION, MIN_PERIODS, generateGrid } from '../domain/schedule'
import { store } from './store'
import { haptic } from './widgets'
import { defaultSemester, mondayOf, todayStr } from './semester'
import { DateInput, Field, Page, PrimaryButton, Row, Stepper, TextAction, TimeSheet, TopBar, md } from './ui'

const WEEKS = 20
const DEFAULT_PERIODS = 10
const DEFAULT_FIRST = 8 * 60

const SOURCES: [string, string][] = [
  ['ai', '让 AI 转换'],
  ['builtin-json', 'JSON'],
  ['builtin-html', '教务系统'],
  ['builtin-xlsx', 'Excel'],
  ['builtin-ics', '日历'],
  ['builtin-csv', 'CSV'],
]

/** 开学日期，落到所在周的周一 */
export function StartDateField({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  return (
    <div className="divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
      <Field k="开学" sub={value ? `第 1 周 ${md(mondayOf(value))} 周一` : undefined}>
        <DateInput value={value} onChange={onChange} />
      </Field>
    </div>
  )
}

export function currentWeek(startDate: string): number {
  return Math.floor(diffDays(todayStr(), startDate) / 7) + 1
}

function Step({ title, sub, onBack, footer, children }: { title: string; sub?: string; onBack?: () => void; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <Page onBack={onBack} root={!onBack}>
      <div className="flex-1 overflow-y-auto px-5 [scrollbar-width:none]">
        <TopBar title={title} sub={sub} onBack={onBack} />
        <div className="mt-6">{children}</div>
      </div>
      <div className="flex-none px-5 pb-[max(22px,env(safe-area-inset-bottom))]">{footer}</div>
    </Page>
  )
}

/** 首次进入：开学日期 → 作息时间 → 课表来源，和应用内其他页面同一套推入 */
export default function Onboarding({ onDone, initialStep = 0, backRef }: { onDone: (ruleId: string | null) => void; initialStep?: number; backRef?: MutableRefObject<() => boolean> }) {
  const [step, setStep] = useState(initialStep)
  if (backRef) {
    backRef.current = () => {
      if (step <= 0) return false
      setStep(step - 1)
      return true
    }
  }
  const [date, setDate] = useState(() => mondayOf(todayStr()))
  const start = mondayOf(date)
  const [count, setCount] = useState(DEFAULT_PERIODS)
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [first, setFirst] = useState(DEFAULT_FIRST)
  const [pickFirst, setPickFirst] = useState(false)
  const grid = useMemo(() => generateGrid(count, duration, first), [count, duration, first])

  const finish = (ruleId: string | null) => {
    store.setSemester({ ...defaultSemester(start), totalWeeks: WEEKS, timeGrid: grid })
    onDone(ruleId)
  }

  return (
    <div className="relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden bg-(--c-bg) font-sans text-(--c-ink)">
      <Page root className="intro-hero">
        <div className="flex flex-1 flex-col px-7 pt-[max(64px,calc(env(safe-area-inset-top)+34px))]">
          <img src="/mascot.png" alt="" className="h-[200px] w-[200px] self-center object-contain" />
          <div className="mt-auto pb-14">
            <div className="text-[17px] font-bold tracking-[.02em] text-(--c-ink3)">嘎嘎课程表</div>
            <h1 className="mt-3 text-[44px] leading-[1.15] font-extrabold tracking-[-.04em]">
              <span className="block text-(--c-ink)">你的课表，</span>
              <span className="block text-(--c-ink4)">理应如此。</span>
            </h1>
          </div>
        </div>
        <div className="flex-none px-5 pb-[max(22px,env(safe-area-inset-bottom))]">
          <PrimaryButton onClick={() => setStep(1)}>开始</PrimaryButton>
        </div>
      </Page>

      <AnimatePresence>
        {step >= 1 && (
          <Step
            key="start"
            title="开学日期"
            sub={`第 ${Math.max(1, currentWeek(start))} 周`}
            onBack={() => setStep(0)}
            footer={<PrimaryButton onClick={() => setStep(2)}>继续</PrimaryButton>}
          >
            <StartDateField value={date} onChange={setDate} />
          </Step>
        )}
        {step >= 2 && (
          <Step
            key="schedule"
            title="作息时间"
            sub={`${count} 节 · ${fmtMinutes(grid[0].start)} – ${fmtMinutes(grid[grid.length - 1].end)}`}
            onBack={() => setStep(1)}
            footer={<PrimaryButton onClick={() => setStep(3)}>继续</PrimaryButton>}
          >
            <div className="rounded-[18px] bg-(--c-surface) px-4">
              <div className="flex items-center py-3">
                <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">每天节数</span>
                <Stepper value={count} unit="节" min={MIN_PERIODS} max={MAX_PERIODS} onChange={setCount} />
              </div>
              <div className="flex items-center border-t border-(--c-line2) py-3">
                <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">每节时长</span>
                <Stepper value={duration} unit="分" min={MIN_DURATION} max={MAX_DURATION} step={DURATION_STEP} onChange={setDuration} />
              </div>
              <div className="flex items-center border-t border-(--c-line2) py-3">
                <span className="flex-1 text-[14px] font-semibold text-(--c-ink)">第 1 节开始</span>
                <button
                  onClick={() => { haptic('press'); setPickFirst(true) }}
                  className="rounded-[10px] bg-(--c-surface2) px-3 py-1.5 text-[15px] font-bold tabular-nums text-(--c-ink) transition-transform duration-150 active:scale-[.96]"
                >
                  {fmtMinutes(first)}
                </button>
              </div>
            </div>
            <div className="mt-5 mb-6 grid grid-cols-2 gap-x-4 rounded-[18px] bg-(--c-surface) px-4 py-2">
              {grid.map((t, i) => (
                <div key={t.index} className={`flex items-center py-[7px] ${i >= 2 ? 'border-t border-(--c-line2)' : ''}`}>
                  <span className="w-[24px] text-[12px] font-bold tabular-nums text-(--c-ink5)">{t.index}</span>
                  <span className="text-[13px] font-semibold tabular-nums text-(--c-ink)">{fmtMinutes(t.start)}</span>
                  <span className="mx-1.5 text-[12px] text-(--c-ink5)">–</span>
                  <span className="text-[13px] font-medium tabular-nums text-(--c-ink4)">{fmtMinutes(t.end)}</span>
                </div>
              ))}
            </div>
            {pickFirst && (
              <TimeSheet
                value={fmtMinutes(first)}
                title="第 1 节开始"
                step={5}
                onPick={(v) => { const [h, m] = v.split(':').map(Number); setFirst(h * 60 + m) }}
                onClose={() => setPickFirst(false)}
              />
            )}
          </Step>
        )}
        {step >= 3 && (
          <Step
            key="source"
            title="课表来源"
            onBack={() => setStep(2)}
            footer={
              <div className="flex justify-center">
                <TextAction tone="mute" onClick={() => finish(null)}>稍后</TextAction>
              </div>
            }
          >
            <div className="divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
              {SOURCES.map(([id, t]) => (
                <Row key={id} title={t} onClick={() => finish(id)} />
              ))}
            </div>
            <div className="mt-5 divide-y divide-(--c-surface2) overflow-hidden rounded-[16px] bg-(--c-surface)">
              <Row title="手动添加" onClick={() => finish('manual')} />
            </div>
          </Step>
        )}
      </AnimatePresence>
    </div>
  )
}
