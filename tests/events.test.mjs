/**
 * events.test.mjs — 人类消息判定的离线测试。
 *
 * 四个样本全部来自 2026-09-26 本会话事件流的**真实形状**（`_tmp_review/temporal-probe.py`），
 * 不是臆造：人类消息、框架快照、记忆注入、子智能体回执走的是同一个 `user/message` 类型。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isHumanMessage, isMasterMessage } from '../lib/events.js'

const human = {
  type: 'user/message',
  data: { content: [], source: { kind: 'user', rpcId: '298bbae7-b42d-45ec-9ae2-51a81da2ea07', clientTimeZone: 'Etc/GMT-8' } },
}
const frameworkSnapshot = {
  type: 'user/message',
  data: { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' } },
}
const memoryRecall = {
  type: 'user/message',
  data: { source: { kind: 'plugin', plugin: 'dsh-agent-memory', form: 'recall' } },
}
const agentMessage = {
  type: 'user/message',
  data: { source: { kind: 'agent-message', senderSessionId: 'b2a4ff3c-a4af-4edc-b71c-cd7ebba6a457' } },
}

test('只有 source.kind === "user" 算主人消息（插件快照/子智能体回执都不算）', () => {
  assert.equal(isHumanMessage(human), true)
  assert.equal(isHumanMessage(frameworkSnapshot), false)
  assert.equal(isHumanMessage(memoryRecall), false)
  assert.equal(isHumanMessage(agentMessage), false)
})

test('尸体：非 user/message、缺 data、缺 source、非法值 ⇒ false（且不抛）', () => {
  assert.equal(isHumanMessage({ type: 'assistant/message', data: { source: { kind: 'user' } } }), false)
  assert.equal(isHumanMessage({ type: 'user/message' }), false)
  assert.equal(isHumanMessage({ type: 'user/message', data: {} }), false)
  assert.equal(isHumanMessage({ type: 'user/message', data: { source: null } }), false)
  assert.equal(isHumanMessage({ type: 'user/message', data: { source: 'user' } }), false)
  assert.equal(isHumanMessage(null), false)
  assert.equal(isHumanMessage(undefined), false)
  assert.equal(isHumanMessage('user/message'), false)
  assert.equal(isHumanMessage(42), false)
})

test('判据不看 content 形状（content 缺失/异形也照样判人类消息）', () => {
  assert.equal(isHumanMessage({ type: 'user/message', data: { source: { kind: 'user' } } }), true)
  assert.equal(isHumanMessage({ type: 'user/message', data: { content: 'x', source: { kind: 'user' } } }), true)
})

test('主人判据：kind=user 且 rpcId 不是 dsh- 内部自动化来源（守护通知不算主人在说话）', () => {
  // 实测形状：守护通知 {"kind":"user","rpcId":"dsh-sentinel-1789473063130"}（seq 11252）
  const sentinelNotice = {
    type: 'user/message',
    data: { source: { kind: 'user', rpcId: 'dsh-sentinel-1789473063130' } },
  }
  assert.equal(isHumanMessage(sentinelNotice), true) // 确实是「人对我说的话」
  assert.equal(isMasterMessage(sentinelNotice), false) // 但不是主人本人
  assert.equal(isMasterMessage(human), true) // 主人在 GUI 里说的（uuid + clientTimeZone）
  assert.equal(isMasterMessage(frameworkSnapshot), false)
  assert.equal(isMasterMessage(memoryRecall), false)
  assert.equal(isMasterMessage(agentMessage), false)
  assert.equal(isMasterMessage(null), false)
  assert.equal(isMasterMessage({ type: 'user/message', data: { source: { kind: 'user' } } }), true) // 无 rpcId ⇒ 算主人（偏向不漏算）
  assert.equal(isMasterMessage({ type: 'user/message', data: { source: { kind: 'user', rpcId: 42 } } }), true)
})
