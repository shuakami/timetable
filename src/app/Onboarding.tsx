import { useState, type MutableRefObject } from 'react'
import { AnimatePresence } from 'motion/react'
import { diffDays } from '../domain/dates'
import { store } from './store'
import { defaultSemester, mondayOf, todayStr } from './semester'
import { DateInput, Field, Page, PrimaryButton, Row, TextAction, TopBar, md } from './ui'

const WEEKS = 20

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

/** 首次进入：三个内页，和应用内其他页面同一套推入 */
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

  const finish = (ruleId: string | null) => {
    store.setSemester({ ...defaultSemester(start), totalWeeks: WEEKS })
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
            key="source"
            title="课表来源"
            onBack={() => setStep(1)}
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
