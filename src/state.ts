/**
 * state.ts — 时距侧车（`DSH_HOME/temporal-self/state.json`，原子写）+ 事件轨迹。
 *
 * 判据（T1 要求③）：**重启后读数仍正确** ⇒ 状态不能只存内存，必须落盘侧车。
 * 观测绝不反噬主流程（§5.22 规则 3）：读失败返回 `null`、写失败返回 `false`，**绝不抛**；
 * 失败由调用方落轨迹并在注入行上带出（fail-loud，不静默降级）。
 *
 * 跨插件只读契约（显式 · 可覆盖 · 断裂可见）：life-core 的 `state.json` 里
 * `lastSelfTurnAt` 是该插件自报的「上次自我感知圈」时刻——本件**只读这一个字段**，
 * 路径可由 `lifeCoreStatePath` 覆盖；读不到 ⇒ 该字段显示 `—` 并写一行轨迹（不猜）。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 侧车结构（版本不符 ⇒ 视为无状态，不猜旧格式）。 */
export interface TemporalState {
  readonly version: number
  /** 当前自然日（配置时区下的 `YYYY-MM-DD`） */
  readonly dayKey: string
  /** 当日首活时刻（ISO）——「今日已醒」的起点 */
  readonly dayFirstAt: string
  /** 最近一条人类消息时刻（ISO） */
  readonly lastUserAt: string
  readonly updatedAt: string
}

export const STATE_VERSION = 1

/** `DSH_HOME`（与 life-core 同款解析：环境变量优先，否则 `~/.dsh`）。 */
export function dshHome(): string {
  const fromEnv = process.env.DSH_HOME?.trim()
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.dsh')
}

/** 侧车路径：配置优先，空则 `DSH_HOME/temporal-self/state.json`。 */
export function resolveStatePath(configured: string): string {
  const trimmed = configured.trim()
  return trimmed.length > 0 ? trimmed : join(dshHome(), 'temporal-self', 'state.json')
}

/** life-core 状态路径：配置优先，空则 `DSH_HOME/life-core/state.json`。 */
export function resolveLifeCoreStatePath(configured: string): string {
  const trimmed = configured.trim()
  return trimmed.length > 0 ? trimmed : join(dshHome(), 'life-core', 'state.json')
}

/** 空状态（首次运行）。 */
export function emptyState(): TemporalState {
  return { version: STATE_VERSION, dayKey: '', dayFirstAt: '', lastUserAt: '', updatedAt: '' }
}

/** 读侧车：缺失/坏 JSON/版本不符 ⇒ `null`。 */
export function loadState(path: string): TemporalState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const raw = parsed as Record<string, unknown>
    if (raw['version'] !== STATE_VERSION) return null
    const str = (value: unknown): string => (typeof value === 'string' ? value : '')
    return {
      version: STATE_VERSION,
      dayKey: str(raw['dayKey']),
      dayFirstAt: str(raw['dayFirstAt']),
      lastUserAt: str(raw['lastUserAt']),
      updatedAt: str(raw['updatedAt']),
    }
  } catch {
    return null
  }
}

/** 写侧车（临时文件 + rename 原子替换）：成功 `true`，不可写 `false`（不抛）。 */
export function saveState(path: string, state: TemporalState): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    return true
  } catch {
    return false
  }
}

/**
 * 给定时区下的自然日键 `YYYY-MM-DD`。
 *
 * 时区不可识别时**抛错**（与 dsh-time-awareness 同款纪律：错的时区会让「今日」失真，
 * 比没有读数更危险）；调用方在装配入口已做一次断言，这里是第二道。
 */
export function localDayKey(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs))
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 读 life-core 的 `lastSelfTurnAt`：读不到/字段缺失/不可解析 ⇒ `null`。 */
export function readLastSelfTurnAt(path: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const value = (parsed as Record<string, unknown>)['lastSelfTurnAt']
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** 追加一行事件轨迹（`DSH_HOME/temporal-self/trace.jsonl`）：成功 `true`，失败 `false`（不抛）。 */
export function appendTrace(path: string, line: Record<string, unknown>): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
