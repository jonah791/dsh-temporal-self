/**
 * apply.test.mjs — 进程内验收（假 ctx，不起宿主）：把「接线是否真的按判据工作」变成实测，
 * 而不是等重启后靠肉眼读我自己的识域。
 *
 * 三拍（阵诀 in-process-acceptance-corpse-test）：
 *   ① 新实现独有字段证明新旧——侧车文件与 trace 行是本次实现独有的产物；
 *   ② 尸体逼走失败分支——不可写路径必须让注入行**带出**标记，而不是静默降级；
 *   ③ 盘上核实终态——断言磁盘上的 state.json 内容，而不是只看返回值。
 *
 * 关键判据（T1 要求③）：**重启后读数仍正确** ⇒ 这里用「重建 apply + 预置侧车」模拟重启。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/index.js'

const MIN = 60_000

/** 假 ctx：只实现本插件用到的四件事（on / systemPrompt.context / effect / logger）。 */
function fakeCtx() {
  const ctx = {
    handlers: new Map(),
    registered: null,
    on(name, fn) {
      ctx.handlers.set(name, fn)
    },
    systemPrompt: {
      context(opts) {
        ctx.registered = opts
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
    logger: { warn() {}, error() {} },
  }
  return ctx
}

function baseConfig(dir, overrides = {}) {
  return {
    enabled: true,
    order: 910,
    timeZone: 'UTC',
    label: '时距',
    statePath: join(dir, 'state.json'),
    lifeCoreStatePath: join(dir, 'life.json'),
    ...overrides,
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('接线：注册 context（name=temporal-self / order 配置位）并注入三源读数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const now = Date.now()
  writeFileSync(
    join(dir, 'life.json'),
    JSON.stringify({ lastSelfTurnAt: new Date(now - 31 * MIN).toISOString(), lastActiveAt: new Date(now).toISOString() }),
    'utf8',
  )
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      // 同一自然日（UTC）内的侧车 ⇒ 当日首活必须**保留**（跨重启不重置）
      dayKey: new Date().toISOString().slice(0, 10),
      dayFirstAt: new Date(now - 372 * MIN).toISOString(),
      lastUserAt: new Date(now - 134 * MIN).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }),
    'utf8',
  )

  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir))

  assert.equal(ctx.registered.name, 'temporal-self')
  assert.equal(ctx.registered.order, 910)
  const text = ctx.registered.text()
  assert.match(text, /^时距｜距主人上条 2h1[34]m｜距自圈 31m｜今日已醒 6h1[12]m$/, `实际：${text}`)
  assert.ok(text.length <= 60)

  // 盘上核实：日界滚动已把 dayKey 更新为当日（UTC），并留下 init 轨迹
  const state = readJson(join(dir, 'state.json'))
  assert.equal(state.dayKey, new Date().toISOString().slice(0, 10))
  assert.equal(state.lastUserAt, new Date(now - 134 * MIN).toISOString())
  const trace = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(trace.some((l) => l.phase === 'init' && l.statePath === join(dir, 'state.json')))
})

test('日界滚动：侧车的 dayKey 不是当日 ⇒ 当日首活重置（旧值的域是别的日子）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const now = Date.now()
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      dayKey: '1970-01-01',
      dayFirstAt: new Date(now - 372 * MIN).toISOString(),
      lastUserAt: new Date(now - 134 * MIN).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }),
    'utf8',
  )
  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir))
  // 沿用旧日的 dayFirstAt 会让「今日已醒」说谎 ⇒ 必须重置为 0m；但主人上条读数跨日仍然有效
  assert.match(ctx.registered.text(), /^时距｜距主人上条 2h1[34]m｜距自圈 —｜今日已醒 0m$/)
  const trace = readFileSync(join(dir, 'trace.jsonl'), 'utf8')
  assert.match(trace, /"phase":"day-rollover"/)
})

test('人类消息入账：事件进 → 侧车落盘 → 读数变 0m；异形事件不抛', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir))
  const handler = ctx.handlers.get('session/event')
  assert.equal(typeof handler, 'function')

  // 先跑一次装配，让当日首活落盘
  ctx.registered.text()
  const before = readJson(join(dir, 'state.json'))
  assert.equal(before.lastUserAt, '')

  handler(null, { type: 'user/message', data: { source: { kind: 'user', rpcId: 'r1' } } })
  const after = readJson(join(dir, 'state.json'))
  assert.notEqual(after.lastUserAt, '')
  assert.ok(Date.now() - Date.parse(after.lastUserAt) < 5_000)
  assert.match(ctx.registered.text(), /距主人上条 0m/)

  // 尸体：插件快照不算主人消息（否则注入会更新自己的输入源）
  const snapshotAt = after.lastUserAt
  handler(null, { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-agent-memory' } } })
  assert.equal(readJson(join(dir, 'state.json')).lastUserAt, snapshotAt)
  // 尸体：守护通知（kind=user 但 rpcId=dsh-sentinel-*）不是主人在说话，不得刷新读数
  handler(null, { type: 'user/message', data: { source: { kind: 'user', rpcId: 'dsh-sentinel-1789473063130' } } })
  assert.equal(readJson(join(dir, 'state.json')).lastUserAt, snapshotAt)
  // 尸体：异形事件不抛
  handler(null, null)
  handler(undefined, 'nonsense')
})

test('重启仍正确（判据③）：新实例读同一侧车，读数与重启前一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const config = baseConfig(dir)

  const first = fakeCtx()
  apply(first, config)
  first.handlers.get('session/event')(null, { type: 'user/message', data: { source: { kind: 'user' } } })
  const lineBefore = first.registered.text()
  const stateOnDisk = readJson(join(dir, 'state.json'))
  assert.notEqual(stateOnDisk.dayFirstAt, '')

  // 模拟重启：内存全丢，只有侧车活着
  const second = fakeCtx()
  apply(second, config)
  const lineAfter = second.registered.text()
  assert.equal(lineAfter, lineBefore)
  assert.equal(readJson(join(dir, 'state.json')).dayFirstAt, stateOnDisk.dayFirstAt)
})

test('尸体 fail-loud：侧车不可写 ⇒ 注入行带出「！（侧车不可写）」，且不抛', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory', 'utf8')
  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir, { statePath: join(blocker, 'state.json') }))

  const text = ctx.registered.text()
  assert.match(text, /！（侧车不可写）$/, `实际：${text}`)
  // 再装配一次：标记保持（不是一次性噪音），也不因重试而抛
  assert.match(ctx.registered.text(), /！（侧车不可写）$/)
})

test('尸体 fail-loud：life-core 读不到 ⇒ 该字段 —（不猜），且读好一次后状态位复位', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir))
  assert.match(ctx.registered.text(), /距自圈 —/)

  writeFileSync(
    join(dir, 'life.json'),
    JSON.stringify({ lastSelfTurnAt: new Date(Date.now() - 5 * MIN).toISOString() }),
    'utf8',
  )
  assert.match(ctx.registered.text(), /距自圈 5m/)
})

test('开关：enabled=false ⇒ 一行不注入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  const ctx = fakeCtx()
  apply(ctx, baseConfig(dir, { enabled: false }))
  assert.equal(ctx.registered, null)
})

test('尸体：时区不可识别 ⇒ 装配入口响亮抛错（不静默回退 UTC）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-apply-'))
  assert.throws(() => apply(fakeCtx(), baseConfig(dir, { timeZone: 'Not/AZone' })), /时区不可识别/)
})
