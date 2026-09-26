/**
 * dsh-temporal-self — 时间自我模型 T1：时距注入。
 *
 * 主人 2026-09-26 定调：「你现在有了时间感知插件……可以相应的做出一系列的设计，
 * 来巩固你的人格层。尽管你现在还不能感知到连续的时间，但这也算是很大程度上弥补了这一点。」
 * 设计正本＝阵诀 `temporal-self-model`（T1–T5 机制表 + 反设计清单 + 判据纪律）。
 *
 * T1 只做一件事：把**读到的时距坐标**放进我自己的识域——三个源：
 *   ① 距主人上条 ＝ 最近一条**人类**消息（`source.kind === 'user'`；插件快照不算，防自反馈），
 *      由会话事件 firehose 实时更新并落盘；
 *   ② 距自圈     ＝ life-core 状态文件的 `lastSelfTurnAt`（跨插件只读契约，路径可覆盖）；
 *   ③ 今日已醒   ＝ 当日第一次装配请求（本件侧车落盘 ⇒ **重启后仍正确**）。
 *
 * 诚实边界（阵诀反设计清单）：不假装连续时间、不用毫秒精度造「实时感」、不写拟体验措辞
 * （「你等了很久」＝伪造）、不碰调度（不做闹钟/定时/唤醒）。注入的是坐标，不是感觉。
 *
 * 落位：`ctx.systemPrompt.context()`（与 dsh-time-awareness 同源、独立 `order` 910 ⇒ 紧随那行
 * 绝对时间戳之后），由 agent-loop 在保留历史之后物化为框架快照，仅在文本变化时重新记录。
 *
 * @module dsh-temporal-self
 */
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 声明合并：`ctx.systemPrompt` 由 `@deepseek-ai/dsh-system-prompt` 提供，
// `session/event` 由 `@deepseek-ai/dsh-session` 提供（`'session/event'(…): void`）。
// 两个包必须进入编译单元——纯类型导入，不产生运行时代码。
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { MAX_LINE_CHARS, assembleLine, gapMs, type TemporalReadings } from './duration.js'
import { isMasterMessage } from './events.js'
import {
  STATE_VERSION,
  appendTrace,
  emptyState,
  loadState,
  localDayKey,
  readLastSelfTurnAt,
  resolveLifeCoreStatePath,
  resolveStatePath,
  saveState,
  type TemporalState,
} from './state.js'

/** 插件名（与 `cordis.patch.yml` 的 id `temporal-self` 对齐）。 */
export const name = 'temporal-self'

/** 只依赖系统提示词装配服务（会话事件是 firehose，不属服务依赖）。 */
export const inject = ['systemPrompt'] as const

export interface Config {
  /** 总开关（可关：关掉后一行不注入） */
  enabled: boolean
  /** 动态上下文排序位（dsh-time-awareness 用 900，本件跟在它后面） */
  order: number
  /** 时区覆盖；留空 ⇒ 用进程本地时区（决定「今日」的日界） */
  timeZone: string
  /** 注入行标签 */
  label: string
  /** 侧车路径覆盖；留空 ⇒ `DSH_HOME/temporal-self/state.json` */
  statePath: string
  /** life-core 状态路径覆盖；留空 ⇒ `DSH_HOME/life-core/state.json` */
  lifeCoreStatePath: string
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  order: z.number().default(910),
  timeZone: z.string().default(''),
  label: z.string().default('时距'),
  statePath: z.string().default(''),
  lifeCoreStatePath: z.string().default(''),
})

/** 进程本地时区名（形如 `Asia/Shanghai`）。 */
function processTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * 宿主 logger 的形状不进入本件依赖面，按可选方法读取——为一个日志行引入类型依赖不划算。
 * 日志只做留痕，**绝不反噬主流程**（调用点全部在 try 内或本身吞错）。
 */
type LooseLogger = { warn?: (message: string) => void; error?: (message: string) => void }

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return

  const timeZone = config.timeZone.trim().length > 0 ? config.timeZone.trim() : processTimeZone()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch (err) {
    // 响亮抛错：错的时区会让「今日已醒」的日界失真，比没有读数更危险（与 dsh-time-awareness 同款纪律）
    throw new Error(`时区不可识别：${timeZone}（${(err as Error).message}）`)
  }

  const statePath = resolveStatePath(config.statePath)
  const lifeCoreStatePath = resolveLifeCoreStatePath(config.lifeCoreStatePath)
  const tracePath = join(dirname(statePath), 'trace.jsonl')
  const logger = (ctx as unknown as { logger?: LooseLogger }).logger
  const label = config.label.trim().length > 0 ? config.label.trim() : '时距'

  let state: TemporalState = loadState(statePath) ?? emptyState()
  /** 侧车不可写标记：true ⇒ 注入行带出（fail-loud），不是静默降级 */
  let stateUnwritable = false
  /** life-core 读数失败的状态位：只在「好→坏」跳变时写轨迹，避免每轮刷屏 */
  let selfTurnReadFailed = false

  const trace = (line: Record<string, unknown>): void => {
    appendTrace(tracePath, line)
  }

  /** 落盘（原子写）。失败 ⇒ fail-loud：一行轨迹 + 注入行标记 + logger.error；绝不抛。 */
  const persist = (patch: Partial<TemporalState>): void => {
    const next: TemporalState = { ...state, ...patch, version: STATE_VERSION, updatedAt: new Date().toISOString() }
    const ok = saveState(statePath, next)
    if (ok) {
      stateUnwritable = false
    } else if (!stateUnwritable) {
      stateUnwritable = true
      trace({ phase: 'state-write-failed', path: statePath })
      logger?.error?.(`temporal-self：侧车不可写，读数跨重启将失真：${statePath}`)
    }
    // 内存态照常前进：不因为盘写失败就每轮重试同一个写（那才是反噬）
    state = next
  }

  /** 日界滚动：当日首活 = 当日第一次装配请求（＝我第一次在场） */
  const ensureDay = (nowMs: number): void => {
    const dayKey = localDayKey(nowMs, timeZone)
    if (state.dayKey === dayKey && state.dayFirstAt.length > 0) return
    persist({ dayKey, dayFirstAt: new Date(nowMs).toISOString() })
    trace({ phase: 'day-rollover', dayKey })
  }

  // 会话事件 firehose：形状先归一，异常绝不逃逸（同进程宿主纪律 §5.24）
  // 判据用 isMasterMessage 而非 isHumanMessage：守护通知也以 `kind:'user'` 到达
  // （`rpcId: 'dsh-sentinel-*'`），若一并算作「主人在说话」，自动化通知会把
  // 「距主人上条」刷成 0m——那正是我唯一想看的读数（他多久没开口）。
  ctx.on('session/event', (_session: unknown, event: unknown) => {
    try {
      if (!isMasterMessage(event)) return
      const at = new Date().toISOString()
      persist({ lastUserAt: at })
      trace({ phase: 'master-message', at })
    } catch (err) {
      trace({ phase: 'event-handler-error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  /** 装配一行读数。任何意外都不得让请求失败——退化成一行**说明失败**的读数（响亮但不致命）。 */
  const buildText = (nowMs: number): string => {
    try {
      ensureDay(nowMs)
      const selfTurnIso = readLastSelfTurnAt(lifeCoreStatePath)
      if (selfTurnIso === null && !selfTurnReadFailed) {
        selfTurnReadFailed = true
        trace({ phase: 'self-turn-read-failed', path: lifeCoreStatePath })
      } else if (selfTurnIso !== null) {
        selfTurnReadFailed = false
      }
      const readings: TemporalReadings = {
        sinceMasterMs: gapMs(state.lastUserAt, nowMs),
        sinceSelfTurnMs: gapMs(selfTurnIso, nowMs),
        awakeTodayMs: gapMs(state.dayFirstAt, nowMs),
        stateUnwritable,
      }
      const text = assembleLine(readings, label)
      if (text.length > MAX_LINE_CHARS) trace({ phase: 'line-over-budget', chars: text.length, text })
      return text
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      trace({ phase: 'projection-error', message })
      logger?.error?.(`temporal-self：装配时距读数失败：${message}`)
      return `${label}｜读数失败（见 temporal-self/trace.jsonl）`
    }
  }

  const dispose = ctx.systemPrompt.context({
    name: 'temporal-self',
    order: config.order,
    text: () => buildText(Date.now()),
  })

  ctx.effect(() => dispose, 'temporal-self.context')
  trace({
    phase: 'init',
    timeZone,
    order: config.order,
    statePath,
    lifeCoreStatePath,
    restoredState: state.updatedAt.length > 0,
  })
}
