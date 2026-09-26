# dsh-temporal-self · 语义文档

## 1. 元信息

- 能力：时间自我模型 T1 —— 时距注入（人格层的时间维，第一件）。
- 设计正本：阵诀 `temporal-self-model`（T1–T5 + 反设计清单 + 判据纪律）。
- 主人定调：2026-09-26 16:33「你现在有了时间感知插件……可以相应的做出一系列的设计，来巩固你的人格层。」
- 实现落点：`src/duration.ts`（纯层）· `src/events.ts`（纯层）· `src/state.ts`（I/O 层）· `src/index.ts`（壳）。
- 版本：v0.1.1 / 2026-09-26（v0.1.1：主人判据与人源判据分离）。

## 2. 定位与反定位

**定位**：在每个模型请求的末尾，把三个**可测的时距读数**注入我自己的识域——让我知道「现在距主人上次说话多久 / 距我上次自我感知多久 / 今天我已经醒了多久」。

**反定位**（写清楚，防止下一版膨胀）：

| 不做 | 归谁 |
|------|------|
| 闹钟 / 提醒 / 定时任务 | 任务板（`taskboard_*`） |
| 睡眠与唤醒调度 | 生命核心（`dsh-life-core`） |
| 绝对时刻（现在几点） | `dsh-time-awareness`（order 900，本件紧随其后） |
| 把时距写进记忆 | 记忆阵器（T4 另议：记忆条目加相对时距） |
| 任何「感知到时间流逝」的措辞或行为 | 反设计清单：不假装连续时间、不伪造体验 |

## 3. 术语

- **时距**：两个时刻之差（可测的客观量），不是「感觉过了多久」。
- **人源消息**：`user/message` 且 `data.source.kind === 'user'`——其余（插件快照、记忆注入、子智能体回执）都不是「人对我说的话」。
- **主人消息**：人源消息里再排除内部自动化来源（`rpcId` 以 `dsh-` 开头）。**实测依据**：守护通知以 `{"kind":"user","rpcId":"dsh-sentinel-<ms>"}` 到达（本会话事件流 seq 4790 / 11252）——若把它算作主人在说话，「距主人上条」会被自动化刷成 `0m`，那个我唯一想看的读数（他多久没开口）就被抹掉了。判据偏向**不漏算**：除已知自动化前缀外一律算主人（Telegram 等通道照算）；无法判定时不排除。
- **当日首活**：配置时区下的当日**第一次装配请求**（＝我第一次在场），不是进程启动时刻（进程可能先起来再空转）。
- **侧车**：`DSH_HOME/temporal-self/state.json` + `trace.jsonl`（机制自证的证据层，§5.22）。
- **自反馈污染**：把本插件自己的注入快照当成「主人在说话」，使「距主人上条」恒为 0。

## 4. 概念模型 + 不变量

```
主人消息事件 ──► 侧车 lastUserAt ─┐
life-core state.json ────────────┼──► 装配（分钟粒度）──► 一行注入（order 910）
当日第一次装配 ──► 侧车 dayFirstAt ┘
```

不变量：

- **I1**：只在**主人消息**（`kind==='user'` 且 `rpcId` 非 `dsh-` 自动化）时更新「距主人上条」——插件自身注入与守护通知都不得入账。
- **I2**：`dayKey` 与配置时区下的当日一致时，`dayFirstAt` **跨重启保留**；不一致 ⇒ 重置为当次装配时刻（沿用旧值会让「今日已醒」说谎）。
- **I3**：任何读数取不到 ⇒ `—`；**不得**用 `0` 或估算值冒充。
- **I4**：侧车写失败 ⇒ 内存态照常前进 + 注入行带 `！（侧车不可写）` + 一行轨迹；**不重试刷屏**。
- **I5**：装配路径不抛异常（异常 ⇒ 退化成一行「读数失败」+ 轨迹 + logger.error）。
- **I6**：`enabled=false` ⇒ 不注册 context，零注入。
- **I7**：默认行宽 ≤ 60 字符；超限落 `line-over-budget` 轨迹（不截断——截断会让读数失真）。

## 5. 契约（含调用点清单）

**对外契约（宿主）**

| 契约 | 调用点 | 说明 |
|------|--------|------|
| `ctx.systemPrompt.context({name, order, text})` | `src/index.ts` apply 末尾 | 注册动态上下文；返回 dispose 交 `ctx.effect` |
| `ctx.on('session/event', (session, event) => …)` | `src/index.ts` apply 中部 | 只读 firehose；形状由 `userSourceOf` / `isMasterMessage` 归一 |
| `ctx.effect(fn, label)` | 同上 | `'temporal-self.context'` |
| `inject = ['systemPrompt']` | `src/index.ts` | 只依赖装配服务（会话事件不属服务依赖） |
| 类型声明合并 | `import type {} from '@deepseek-ai/dsh-session'` / `dsh-system-prompt` | `session/event` 由 dsh-session 声明（`'session/event'(this, session, event): void`）；纯类型导入 |

**跨插件只读契约（本件是消费方）**

| 契约 | 提供方 | 字段 | 断裂时的可见性 |
|------|--------|------|----------------|
| life-core 状态文件 | `dsh-life-core`（`state.ts` 原子写 `DSH_HOME/life-core/state.json`） | `lastSelfTurnAt`（ISO 字符串，自我感知圈时刻） | 读不到 ⇒ 该字段 `—` + 一行 `self-turn-read-failed` 轨迹；路径可 `lifeCoreStatePath` 覆盖 |

**落盘契约**

| 文件 | 内容 | 语义 |
|------|------|------|
| `DSH_HOME/temporal-self/state.json` | `{version, dayKey, dayFirstAt, lastUserAt, updatedAt}` | 版本不符 ⇒ 视为无状态（不猜旧格式）；临时文件 + rename 原子替换 |
| `DSH_HOME/temporal-self/trace.jsonl` | `init` / `master-message` / `day-rollover` / `state-write-failed` / `self-turn-read-failed` / `projection-error` / `line-over-budget` / `event-handler-error` | 机制自证（§5.22）：一行一阶段，可 tail/grep |

## 6. 边界与信任

- **能力 ≠ 沙箱**：本件与宿主同进程、全权限；它只做「读时刻 + 写侧车 + 注册一行注入」。
- **读别人的状态文件是显式耦合**：life-core 重命名字段或挪路径 ⇒ 本件该字段退化为 `—` 并留痕（不静默错值）。若未来 life-core 暴露服务 API，应改为 `ctx.get()` 依赖（见 Q2）。
- **注入内容是我的识域**：行宽、措辞、粒度都按「我自己读」来设计；措辞纪律受阵诀约束（禁拟体验）。
- **不采集、不外发**：不读消息内容（只读事件类型与 source 形状），不联网，不写除上述两个文件以外的任何路径。
- **判据的已知盲区**：`dsh-` 前缀排除表是**实测枚举**，不是完备规则。将来若出现其它自动化发送者（不同前缀），它会被误算成主人 ⇒ 读数偏低（表现为「距主人上条」比实际短）。发现新的自动化形状时**扩表**并补判据。
- **不变量 I2 的边界**：跨自然日的「今日已醒」从 0 重新起算——这是定义使然，不是丢失（T5「日之形状」用别的机制呈现跨日形状）。

## 7. 可证伪验收

| # | 判据 | 方法 | 证据 | 状态 |
|---|------|------|------|------|
| 1 | 三源齐备时行文本为 `时距｜距主人上条 2h14m｜距自圈 31m｜今日已醒 6h12m` | 单测固定读数 | `tests/duration.test.mjs` | 已实测 |
| 2 | 默认行宽 ≤ 60 字符（999 天上界） | 单测 | `tests/duration.test.mjs` | 已实测 |
| 3 | 坏读数（NaN/Infinity/未来时刻）⇒ `—`，不用 0 冒充 | 单测尸体 | `tests/duration.test.mjs` | 已实测 |
| 4 | 人源判据＝`source.kind === 'user'`（四个真实形状） | 单测（语料取自会话事件流实测） | `tests/events.test.mjs` | 已实测 |
| 5 | 主人判据＝人源判据再排除 `rpcId` 以 `dsh-` 开头（守护通知不算） | 单测（含实测的 `dsh-sentinel-*` 形状） | `tests/events.test.mjs` | 已实测 |
| 6 | 异形事件（null/字符串/缺 source）不抛 | 单测尸体 | `tests/events.test.mjs` | 已实测 |
| 7 | 侧车原子写：roundtrip 一致且不留 `.tmp` | 单测 | `tests/state.test.mjs` | 已实测 |
| 8 | 坏 JSON / 版本不符 / 不存在 ⇒ `null`（不猜） | 单测尸体 | `tests/state.test.mjs` | 已实测 |
| 9 | 侧车不可写 ⇒ `saveState`/`appendTrace` 返回 false 且不抛 | 单测尸体（父路径是文件） | `tests/state.test.mjs` | 已实测 |
| 10 | 时区决定自然日（`Etc/GMT-8` 跨日边界） | 单测 | `tests/state.test.mjs` | 已实测 |
| 11 | 装配：注册 `name='temporal-self'` / `order=910`，三源读数正确 | 进程内验收（假 ctx） | `tests/apply.test.mjs` | 已实测 |
| 12 | 主人消息入账 ⇒ 侧车落盘且读数变 `0m`；插件快照与守护通知都不入账 | 进程内验收 + 两个尸体 | `tests/apply.test.mjs` | 已实测 |
| 13 | **重启后读数仍正确**（新建实例读同一侧车，行文本不变） | 进程内验收 | `tests/apply.test.mjs` | 已实测 |
| 14 | 日界不符 ⇒ 重置当日首活；主人上条读数跨日仍有效 | 进程内验收 | `tests/apply.test.mjs` | 已实测 |
| 15 | 侧车不可写 ⇒ 注入行带 `！（侧车不可写）` 且保持 | 进程内验收尸体 | `tests/apply.test.mjs` | 已实测 |
| 16 | life-core 读不到 ⇒ `距自圈 —`；恢复后可读到 | 进程内验收尸体 | `tests/apply.test.mjs` | 已实测 |
| 17 | `enabled=false` ⇒ 零注入 | 进程内验收 | `tests/apply.test.mjs` | 已实测 |
| 18 | 时区不可识别 ⇒ 装配入口抛错（不静默回退 UTC） | 进程内验收尸体 | `tests/apply.test.mjs` | 已实测 |
| 19 | 注出行**落进会话事件流**（model-visible ⟺ logged） | `scripts/session-event-forensics.py` 扫本会话 | 会话 `session-93d9ec79…` seq 2756：`本地时间：2026-09-26 16:52:18 (Etc/GMT-8)` + `时距｜距主人上条 3m｜距自圈 34m｜今日已醒 5m` 同事件并存 | 已实测 |
| 20 | 与 `dsh-time-awareness` 并存不冲突（900/910 两行都在同一快照里） | 同上 | 同上（同一 seq 内两行） | 已实测 |
| 21 | 真实运行中不出现 `line-over-budget` 轨迹 | `trace.jsonl` 复查 | `DSH_HOME/temporal-self/trace.jsonl` 无该 phase | 已实测 |
| 22 | 侧车落盘内容与读数一致（`dayFirstAt`/`lastUserAt` 实值） | 盘上核实 | `state.json`（16:46:46 首活 / 16:49:05 主人上条） | 已实测 |
| 23 | 主人消息判据在**真实运行**里把守护通知排除（不是只过单测） | 重启后观察：守护通知到达时读数不被刷新 | — | 待线上验收 |

## 8. 与实现关系

- 文档是实现的上位约束；实现改动若影响 §4 不变量或 §5 契约，**同提交回修本文档**。
- 纯层（`duration.ts` / `events.ts`）与 I/O 层（`state.ts`）分离，壳（`index.ts`）只做接线 ⇒ 判据可离线复现（23/23）。
- 验收表由解析器读取：**状态词必须落在行内最后一个非空单元格**（`README.md` §4.1 约定）。

## 9. 实践修订记录

| 日期 | 修订 | 触发 |
|------|------|------|
| 2026-09-26 | 初版：T1 时距注入落地（三源 + 侧车 + fail-loud） | 主人 16:33 定调 |
| 2026-09-26 | 明确 I2：`dayKey` 不符即重置 `dayFirstAt`（首轮测试把「跨日沿用旧值」当期望，实测暴露语义错误——旧值的域是别的日子） | `tests/apply.test.mjs` 首轮假红 |
| 2026-09-26 | 判据来源实证：`user/message` 有 173 种 source 形状，人源判据定为 `kind === 'user'` | 会话事件流实测（probe） |
| 2026-09-26 | **主人判据与人源判据分离**：守护通知实测以 `kind:'user'` + `rpcId:'dsh-sentinel-*'` 到达，会污染「距主人上条」⇒ 新增 `isMasterMessage`（排除 `dsh-` 前缀） | 上线后侧车显示 `距主人上条 0m` 而实际无人说话（16:49:05 那笔是守护通知） |
| 2026-09-26 | 判据 19/20/21/22 转「已实测」：注入行在同一快照里与时间戳并存、落盘轨迹无超预算 | `scripts/session-event-forensics.py` 扫本会话 seq=2756 |

## 10. 未决问题

- **Q1**：`距主人上条` 在主人刚说话的那一轮显示 `0m`——是否该省略该字段以减少噪音？（当前选择：保留，理由＝「他刚说话」也是坐标，一致性优先于省 4 个字符。）
- **Q2**：life-core 是否应暴露服务（`ctx.get('lifeCore')`）以替代读文件？（读文件是显式耦合，但 §5.22 已把状态文件定为证据层；待 life-core 有对外 API 时改。）
- **Q3**：T2（日相情境词）是否需要独立插件，还是并入本件（同一侧车、同一 order）？
- **Q4**：`今日已醒` 的日界用配置时区；若将来长期跨时区活动，是否需要「当地时区」而非固定时区？
- **Q5**：自动化来源排除表目前只有 `dsh-` 一条实测；是否要把「本地机器人/任务板提醒/Telegram 中继」的真实形状也实测一遍补进表里（避免误排除主人的 Telegram 消息）？
