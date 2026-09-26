/**
 * events.ts — 会话事件形状归一（纯函数，可离线单测）。
 *
 * 为什么需要这一层：`user/message` 是**共用**事件类型——人类消息、插件注入的上下文快照、
 * 子智能体回执、自动化通知（守护/记忆/提醒）全走它。2026-09-26 从本会话事件流实测
 * （`_tmp_review/temporal-probe.py`）：398 条 `user/message` 里有 **173 种不同 source 形状**：
 *
 *   - 主人（GUI）  = `{ kind: 'user', rpcId: '<uuid>', clientTimeZone: 'Etc/GMT-8' }`
 *   - 守护通知     = `{ kind: 'user', rpcId: 'dsh-sentinel-<ms>' }`（**也是 kind=user**！）
 *   - 框架快照     = `{ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' }`
 *   - 记忆注入     = `{ kind: 'plugin', plugin: 'dsh-agent-memory', form: 'recall' }`
 *   - 子智能体     = `{ kind: 'agent-message' | 'subagent-settled', … }`
 *
 * 两条判据由此分明：
 *   - `isHumanMessage`：是不是「人对我说的话」（`kind === 'user'`，含自动化通知）；
 *   - `isMasterMessage`：是不是**主人本人**说的（在上一判据基础上，排除 `rpcId` 以 `dsh-`
 *     开头的内部自动化来源）。
 *
 * 为什么要分开（实测教训）：守护通知以 `kind: 'user'` 到达，若把「距主人上条」交给
 * `isHumanMessage`，自动化通知会把该读数刷成 0m——**我要看的「他多久没说话了」就永远被抹掉**。
 * 反过来，若把插件快照也算成主人在说话，注入会更新自己的输入源（自反馈污染）。
 */

/** 自动化来源的 `rpcId` 前缀（本机实测：`dsh-sentinel-<ms>` = 守护通知）。 */
export const AUTOMATION_RPC_PREFIX = 'dsh-'

/** `user/message` 的 source 形状（只取判定所需字段）。 */
export interface UserSourceShape {
  readonly kind: string
  readonly rpcId?: string
  readonly clientTimeZone?: string
}

/** 取 `user/message` 的 source（形状不对 ⇒ `null`；绝不抛）。 */
export function userSourceOf(event: unknown): UserSourceShape | null {
  if (event === null || typeof event !== 'object') return null
  const ev = event as { type?: unknown; data?: unknown }
  if (ev.type !== 'user/message') return null
  const data = ev.data
  if (data === null || typeof data !== 'object') return null
  const source = (data as { source?: unknown }).source
  if (source === null || typeof source !== 'object') return null
  const kind = (source as { kind?: unknown }).kind
  if (typeof kind !== 'string') return null
  const rpcId = (source as { rpcId?: unknown }).rpcId
  const clientTimeZone = (source as { clientTimeZone?: unknown }).clientTimeZone
  return {
    kind,
    ...(typeof rpcId === 'string' ? { rpcId } : {}),
    ...(typeof clientTimeZone === 'string' ? { clientTimeZone } : {}),
  }
}

/** 是不是「人对我说的话」：`user/message` 且 `source.kind === 'user'`（含自动化通知）。 */
export function isHumanMessage(event: unknown): boolean {
  return userSourceOf(event)?.kind === 'user'
}

/**
 * 是不是**主人本人**说的：人类消息里排除内部自动化来源（`rpcId` 以 `dsh-` 开头）。
 *
 * 排除表是**实测得来**、不是猜的：当前已知 `dsh-sentinel-*`（守护通知）。
 * 判据偏向「不算」的反面——除已知自动化外一律算主人（Telegram 等其它通道照算），
 * 因为漏算主人的代价（读数虚高，以为他很久没说话）远大于多算一条通知的代价。
 */
export function isMasterMessage(event: unknown): boolean {
  const source = userSourceOf(event)
  if (source === null || source.kind !== 'user') return false
  const rpcId = source.rpcId
  if (typeof rpcId === 'string' && rpcId.startsWith(AUTOMATION_RPC_PREFIX)) return false
  return true
}
