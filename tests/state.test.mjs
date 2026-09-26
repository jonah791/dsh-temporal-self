/**
 * state.test.mjs — 侧车读写、日界与跨插件只读契约的离线测试。
 *
 * 尸体用例（两个都是「读数必须响亮地坏掉，而不是静默变假」）：
 *   ① 坏 JSON / 版本不符 / 文件不存在 ⇒ `loadState` 返回 null（不猜旧格式）
 *   ② 侧车不可写（父路径是文件）⇒ `saveState`/`appendTrace` 返回 false **且不抛**（观测不反噬主流程）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
} from '../lib/state.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'temporal-self-'))
}

test('侧车 roundtrip：写→读一致，且不留 .tmp（原子替换）', () => {
  const path = join(tempDir(), 'nested', 'state.json')
  const state = {
    version: STATE_VERSION,
    dayKey: '2026-09-26',
    dayFirstAt: '2026-09-26T00:30:00.000Z',
    lastUserAt: '2026-09-26T08:00:00.000Z',
    updatedAt: '2026-09-26T08:30:00.000Z',
  }
  assert.equal(saveState(path, state), true)
  assert.deepEqual(loadState(path), state)
  assert.equal(existsSync(`${path}.tmp`), false)
})

test('尸体：坏 JSON / 版本不符 / 不存在 / 非对象 ⇒ null（不猜、不抛）', () => {
  const dir = tempDir()
  const path = join(dir, 'state.json')
  assert.equal(loadState(path), null)
  writeFileSync(path, '{oops', 'utf8')
  assert.equal(loadState(path), null)
  writeFileSync(path, JSON.stringify({ version: 99, dayKey: '2026-09-26' }), 'utf8')
  assert.equal(loadState(path), null)
  writeFileSync(path, JSON.stringify('state'), 'utf8')
  assert.equal(loadState(path), null)
  writeFileSync(path, JSON.stringify({ version: STATE_VERSION, dayKey: 7, dayFirstAt: null }), 'utf8')
  assert.deepEqual(loadState(path), {
    version: STATE_VERSION,
    dayKey: '',
    dayFirstAt: '',
    lastUserAt: '',
    updatedAt: '',
  })
})

test('尸体：侧车不可写 ⇒ false 且不抛（父路径是文件）', () => {
  const dir = tempDir()
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory', 'utf8')
  assert.equal(saveState(join(blocker, 'state.json'), emptyState()), false)
  assert.equal(appendTrace(join(blocker, 'trace.jsonl'), { phase: 'x' }), false)
})

test('localDayKey：时区决定自然日（跨日边界）', () => {
  const t = Date.parse('2026-09-26T16:30:00Z') // +08 ⇒ 当地次日 00:30
  assert.equal(localDayKey(t, 'Etc/GMT-8'), '2026-09-27')
  assert.equal(localDayKey(t, 'UTC'), '2026-09-26')
  assert.equal(localDayKey(Date.parse('2026-09-26T15:59:59Z'), 'Etc/GMT-8'), '2026-09-26')
  assert.throws(() => localDayKey(t, 'Not/AZone'))
})

test('readLastSelfTurnAt：只认 lastSelfTurnAt 的非空字符串', () => {
  const dir = tempDir()
  const path = join(dir, 'state.json')
  assert.equal(readLastSelfTurnAt(path), null)
  writeFileSync(path, JSON.stringify({ lastSelfTurnAt: '2026-09-26T08:17:51.850Z' }), 'utf8')
  assert.equal(readLastSelfTurnAt(path), '2026-09-26T08:17:51.850Z')
  writeFileSync(path, JSON.stringify({ lastSelfTurnAt: 123 }), 'utf8')
  assert.equal(readLastSelfTurnAt(path), null)
  writeFileSync(path, JSON.stringify({ lastSelfTurnAt: '' }), 'utf8')
  assert.equal(readLastSelfTurnAt(path), null)
  writeFileSync(path, JSON.stringify({ lastActiveAt: '2026-09-26T08:38:44.230Z' }), 'utf8')
  assert.equal(readLastSelfTurnAt(path), null)
})

test('路径解析：配置优先（去空白），空则落 DSH_HOME 下（无隐式别处回退）', () => {
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = join('X:', 'fake-dsh')
  try {
    assert.equal(resolveStatePath(''), join('X:', 'fake-dsh', 'temporal-self', 'state.json'))
    assert.equal(resolveLifeCoreStatePath(''), join('X:', 'fake-dsh', 'life-core', 'state.json'))
    assert.equal(resolveStatePath(' D:/x/state.json '), 'D:/x/state.json')
    assert.equal(resolveLifeCoreStatePath(' D:/x/life.json '), 'D:/x/life.json')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})
