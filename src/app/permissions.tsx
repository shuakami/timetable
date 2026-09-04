import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Page, PrimaryButton, SLIDE, TopBar } from './ui'
import { CHANNEL, exactAlarmsAllowed, notificationsAllowed, requestExactAlarms, requestNotifications } from './notify'
import { batteryOptimizationsIgnored, openAutostartSettings, openChannelSettings, requestIgnoreBattery } from './widgets'

type BannerState = 'pending' | 'seen' | 'done'

interface Status {
  notif: boolean
  banner: BannerState
  exact: boolean
  battery: boolean
}

const SEEN_KEY = 'tt.perms.banner.seen.v1'
const DONE_KEY = 'tt.perms.done.v1'

function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* 忽略 */ }
}

/* ============================================================
 * 屏 2 · 锁屏与横幅（内页）
 * 在进入「系统设置」前，列出系统通知页里需手动打开的项。
 * 底部「去系统设置」直跳 ACTION_CHANNEL_NOTIFICATION_SETTINGS。
 * ============================================================ */
export function BannerHelpPage({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <Page onBack={onBack}>
      <div className="flex flex-1 flex-col px-5">
        <TopBar title="锁屏与横幅" onBack={onBack} />

        <div className="mt-6 flex flex-col gap-3">
          <Bullet
            title="锁屏显示"
            path={['通知页', '锁屏显示', '显示所有内容']}
          />
          <Bullet
            title="横幅通知"
            path={['通知页', '横幅通知', '允许（可同时开悬浮通知）']}
          />
          <Bullet
            title="置顶（重要程度）"
            path={['通知页右上角', '设为紧急', '优先弹横幅而非静默进状态栏']}
          />
        </div>
      </div>

      <div className="flex-none px-5 pb-[max(22px,env(safe-area-inset-bottom))]">
        <PrimaryButton
          onClick={() => {
            try { localStorage.setItem(SEEN_KEY, '1') } catch { /* 忽略 */ }
            onDone()
          }}
        >
          去系统设置
        </PrimaryButton>
      </div>
    </Page>
  )
}

function Bullet({ title, path }: { title: string; path: string[] }) {
  return (
    <div className="rounded-[18px] bg-(--c-surface) px-4 py-3.5">
      <div className="text-[14px] font-bold tracking-[-.01em] text-(--c-ink)">{title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-[1.5] font-medium text-(--c-ink4)">
        {path.map((seg, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-(--c-ink5)">
                <path d="m9 5 7 7-7 7" />
              </svg>
            )}
            <span>{seg}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
 * 屏 1 · 系统权限
 * - 首次引导：isFirstTime=true，TopBar 无返回键，底部「好了」
 * - 设置入口：isFirstTime=false，TopBar 有返回键，底部「完成」
 * 从系统设置页返回时自动重检各行（visibilitychange）。
 * ============================================================ */
export function PermsPage({
  onBack,
  isFirstTime,
  onFinish,
}: {
  onBack: () => void
  isFirstTime?: boolean
  onFinish: () => void
}) {
  const [s, setS] = useState<Status>({ notif: false, banner: 'pending', exact: false, battery: false })
  const [helpOpen, setHelpOpen] = useState(false)
  const finish = useCallback(() => { markDone(); onFinish() }, [onFinish])

  const load = useCallback(async () => {
    const [notif, exact, battery] = await Promise.all([
      notificationsAllowed(),
      exactAlarmsAllowed(),
      batteryOptimizationsIgnored(),
    ])
    setS((prev) => {
      const bannerNext = prev.banner === 'seen' && notif ? 'seen' : prev.banner
      return { notif, banner: bannerNext, exact, battery }
    })
  }, [])

  useEffect(() => { void load() }, [load])

  // 横幅与锁屏：已在系统页看过 = 已允许
  useEffect(() => {
    try { if (localStorage.getItem(SEEN_KEY) === '1') setS((p) => ({ ...p, banner: 'seen' })) } catch { /* 忽略 */ }
  }, [])

  // 从系统页返回时重检
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const goChannel = useCallback(() => {
    setS((prev) => ({ ...prev, banner: 'seen' }))
    openChannelSettings(CHANNEL)
  }, [])

  return (
    <>
      <Page onBack={isFirstTime ? undefined : onBack}>
        <div className="flex flex-1 flex-col px-5">
          <TopBar title={isFirstTime ? '开启提醒' : '提醒与权限'} onBack={isFirstTime ? undefined : onBack} />

          {/* 5 行列表 */}
          <div className="mt-6 overflow-hidden rounded-[18px] bg-(--c-surface)">
            <Row
              label="通知"
              done={s.notif}
              onPress={async () => {
                const ok = await requestNotifications()
                setS((prev) => ({ ...prev, notif: ok }))
                if (ok) void load()
              }}
              actionLabel="开启"
            />
            <Row
              label="锁屏与横幅"
              done={s.banner === 'seen'}
              onPress={() => setHelpOpen(true)}
              actionLabel={s.banner === 'pending' ? '去设置' : '已开启'}
            />
            {s.exact ? null : (
              <Row
                label="准点提醒"
                done={false}
                onPress={async () => {
                  const ok = await requestExactAlarms()
                  setS((prev) => ({ ...prev, exact: ok }))
                }}
                actionLabel="允许"
              />
            )}
            <Row
              label="保持后台运行"
              done={s.battery}
              onPress={async () => {
                const ok = await requestIgnoreBattery()
                setS((prev) => ({ ...prev, battery: ok }))
              }}
              actionLabel="设置"
            />
            <Row
              label="开机自启"
              done={false}
              onPress={() => { openAutostartSettings() }}
              actionLabel="去设置"
            />
          </div>
        </div>

        <div className="flex-none px-5 pb-[max(22px,env(safe-area-inset-bottom))]">
          <PrimaryButton onClick={finish}>{isFirstTime ? '好了' : '完成'}</PrimaryButton>
        </div>
      </Page>

      {/* 屏 2 推入：锁屏与横幅 */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div
            key="banner-help"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={SLIDE}
            className="absolute inset-0 z-[60]"
          >
            <BannerHelpPage
              onBack={() => setHelpOpen(false)}
              onDone={() => {
                setHelpOpen(false)
                goChannel()
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function Row({
  label,
  done,
  onPress,
  actionLabel,
}: {
  label: string
  done: boolean
  onPress: () => void
  actionLabel: string
}) {
  return (
    <button
      onClick={done ? undefined : onPress}
      disabled={done}
      className={`flex h-[52px] w-full items-center px-4 text-left transition-opacity ${
        done ? 'cursor-default' : 'active:opacity-60'
      }`}
    >
      <span className={`flex-1 text-[14px] font-semibold ${done ? 'text-(--c-ink5)' : 'text-(--c-ink)'}`}>{label}</span>
      <span className={`text-[12.5px] font-bold ${done ? 'text-(--c-ink5)' : 'text-(--c-accent)'}`}>
        {done ? '已开启' : actionLabel}
      </span>
    </button>
  )
}
