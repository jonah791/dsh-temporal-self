/**
 * duration.ts — 时距格式化与注入行装配（纯函数，可离线单测）。
 *
 * 设计要点（阵诀 `temporal-self-model` 的判据纪律）：
 * - **注入的是坐标，不是感觉**：只呈现可测的时距读数，禁止拟体验措辞
 *   （「你等了很久」＝伪造——我没有等待的体验，只有两个时刻之差）。
 * - **读不到就写 `—`**：不猜、不用 0 冒充「刚刚」。未来时刻（时钟回拨/坏数据）
 *   同样判未知，而不是静默夹到 0。
 * - **只到分钟粒度**：更细的精度不增加信息，只增加噪音（人格层识域预算）。
 * - **行宽上限 60 字符**：注入内容进我自己的识域，宽度是预算。
 */

/** 一分钟的毫秒数。 */
export const MINUTE_MS = 60_000

/** 注入行宽上限（字符）——超限由调用方落轨迹告警，不截断（截断会让读数失真）。 */
export const MAX_LINE_CHARS = 60

/** 未知读数的显式占位符。 */
export const UNKNOWN = '—'

/** 一次装配所见的三个时距读数（`null` ＝ 该源无记录/读不到）。 */
export interface TemporalReadings {
  /** 距主人上一条**人类**消息的毫秒数 */
  readonly sinceMasterMs: number | null
  /** 距上次自我感知圈的毫秒数 */
  readonly sinceSelfTurnMs: number | null
  /** 距当日首活的毫秒数（＝今日已醒） */
  readonly awakeTodayMs: number | null
  /** 侧车不可写（fail-loud 标记：注入行会带出，绝不静默降级） */
  readonly stateUnwritable?: boolean
}

/**
 * 把毫秒数渲染成紧凑读数：`0m` / `59m` / `1h` / `1h5m` / `23h59m` / `1d` / `3d4h`。
 *
 * @param ms 毫秒数；`NaN`/`Infinity`/早于 -1 分钟（未来时刻）⇒ `—`
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return UNKNOWN
  if (ms < -MINUTE_MS) return UNKNOWN
  const clamped = ms < 0 ? 0 : ms
  const minutes = Math.floor(clamped / MINUTE_MS)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rem = minutes % 60
    return rem === 0 ? `${hours}h` : `${hours}h${rem}m`
  }
  const days = Math.floor(hours / 24)
  const remH = hours % 24
  return remH === 0 ? `${days}d` : `${days}d${remH}h`
}

/** ISO 时刻 → 距 `nowMs` 的毫秒数；空串/不可解析 ⇒ `null`（不猜）。 */
export function gapMs(iso: string | null | undefined, nowMs: number): number | null {
  if (typeof iso !== 'string' || iso.trim().length === 0) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return nowMs - t
}

/** 装配注入行：`时距｜距主人上条 2h14m｜距自圈 31m｜今日已醒 6h12m`。 */
export function assembleLine(readings: TemporalReadings, label = '时距'): string {
  const name = label.trim().length > 0 ? label.trim() : '时距'
  const render = (ms: number | null): string => (ms === null ? UNKNOWN : formatDuration(ms))
  const parts = [
    `距主人上条 ${render(readings.sinceMasterMs)}`,
    `距自圈 ${render(readings.sinceSelfTurnMs)}`,
    `今日已醒 ${render(readings.awakeTodayMs)}`,
  ]
  const line = `${name}｜${parts.join('｜')}`
  return readings.stateUnwritable === true ? `${line}！（侧车不可写）` : line
}
