/**
 * duration.test.mjs — 时距格式化与注入行装配的离线测试（固定读数，结果确定可复现）。
 *
 * 尸体用例：坏读数（NaN / Infinity / 未来时刻）必须写 `—`，**不得用 0 冒充「刚刚」**——
 * 读数失真的代价比没有读数大：我会拿 0 当「他刚说过话」的事实。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_LINE_CHARS, UNKNOWN, assembleLine, formatDuration, gapMs } from '../lib/duration.js'

const MIN = 60_000
const HOUR = 60 * MIN

test('formatDuration：分钟 / 小时 / 天三档边界', () => {
  assert.equal(formatDuration(0), '0m')
  assert.equal(formatDuration(59_999), '0m')
  assert.equal(formatDuration(MIN), '1m')
  assert.equal(formatDuration(59 * MIN + 59_000), '59m')
  assert.equal(formatDuration(HOUR), '1h')
  assert.equal(formatDuration(HOUR + 5 * MIN), '1h5m')
  assert.equal(formatDuration(23 * HOUR + 59 * MIN), '23h59m')
  assert.equal(formatDuration(24 * HOUR), '1d')
  assert.equal(formatDuration(27 * HOUR), '1d3h')
  assert.equal(formatDuration(8 * 24 * HOUR), '8d')
})

test('尸体：坏读数 ⇒ —（不用 0 冒充）；1 分钟内的负偏移夹到 0m', () => {
  assert.equal(formatDuration(Number.NaN), UNKNOWN)
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), UNKNOWN)
  assert.equal(formatDuration(-5 * MIN), UNKNOWN)
  assert.equal(formatDuration(-30_000), '0m')
})

test('gapMs：ISO 时刻 → 毫秒差；空/不可解析 ⇒ null', () => {
  assert.equal(gapMs('', 0), null)
  assert.equal(gapMs(null, 0), null)
  assert.equal(gapMs(undefined, 0), null)
  assert.equal(gapMs('不是时刻', 0), null)
  assert.equal(gapMs('2026-09-26T08:00:00.000Z', Date.parse('2026-09-26T09:30:00.000Z')), 90 * MIN)
})

test('assembleLine：三源齐备 / 缺源写 — / 侧车不可写带标记', () => {
  assert.equal(
    assembleLine({ sinceMasterMs: 134 * MIN, sinceSelfTurnMs: 31 * MIN, awakeTodayMs: 372 * MIN }),
    '时距｜距主人上条 2h14m｜距自圈 31m｜今日已醒 6h12m',
  )
  assert.equal(
    assembleLine({ sinceMasterMs: null, sinceSelfTurnMs: null, awakeTodayMs: null }),
    '时距｜距主人上条 —｜距自圈 —｜今日已醒 —',
  )
  assert.equal(
    assembleLine({ sinceMasterMs: 0, sinceSelfTurnMs: 0, awakeTodayMs: 0, stateUnwritable: true }),
    '时距｜距主人上条 0m｜距自圈 0m｜今日已醒 0m！（侧车不可写）',
  )
})

test('默认行宽 ≤ 60 字符（识域预算）；标签空白 ⇒ 回退「时距」', () => {
  const worst = assembleLine({
    sinceMasterMs: 999 * 24 * HOUR,
    sinceSelfTurnMs: 999 * 24 * HOUR,
    awakeTodayMs: 999 * 24 * HOUR,
  })
  assert.ok(worst.length <= MAX_LINE_CHARS, `行宽 ${worst.length} 超预算：${worst}`)
  assert.ok(assembleLine({ sinceMasterMs: 0, sinceSelfTurnMs: 0, awakeTodayMs: 0 }, '   ').startsWith('时距｜'))
  assert.ok(assembleLine({ sinceMasterMs: 0, sinceSelfTurnMs: 0, awakeTodayMs: 0 }, '时距坐标').startsWith('时距坐标｜'))
})
