# 多站点协议自动化履约 v1

## 目标

商城订单不再由本地 Go/Python/浏览器执行 ChatGPT Checkout。每个外部站点由一个代码 Adapter 对接其原始 API 文档；同协议的多个站点实例复用同一个 Adapter，不在本系统中虚构站点没有提供的接口、套餐或参数。

首个 Adapter 为 `Automate API v1`，只调用文档已有的三个接口：

- `GET /api/v1/automate/config`
- `POST /api/v1/automate/tasks`
- `GET /api/v1/automate/tasks/{taskId}`

Automate API 的 `task.status=succeeded` 是订单完成的权威结果：目标订阅已生效且自动续费已关闭。本系统不再对该订单调用本地订阅复查或取消续费接口。

## 完整流程

```text
前台提交 CDK + Session
        |
        v
创建 redeem_order + automation_execution
        |
        +-- 命中订单排除规则 --> manual_hold
        |
        v
waiting_gate
        |
        +-- Gate 关闭 --> 保持等待，不选卡、不充值、不调用 POST /tasks
        |
        v
同步并校验站点 /config（默认每 5 分钟）
        |
        v
按商城交付商品映射、优先级、并发、日风险额度选择站点
        |
        v
保存不可变映射快照 + clientOrderId
        |
        v
选择本地卡台与卡片、预留容量、必要时开卡或充值
        |
        v
完整卡号/CVC 仅在 Node 进程内存中读取
        |
        v
POST /tasks（Session + 卡资料）
        |
        +-- 明确未创建任务 --> 记录 attempt，允许路由下一条兼容映射
        |
        +-- 超时/网络不明 --> 固定原站点、原 Key、原 clientOrderId 幂等重放
        |
        v
queued / running：每 3 秒 GET 原 taskId
        |
        +-- succeeded --> 订单成功、CDK used、容量 consumed、清除 Session
        |
        +-- failed/cancelled --> 订单失败、CDK active、容量 released、清除 Session
        |
        +-- manual_review --> Session/CDK/容量永久保留，等待管理员裁决
        |
        +-- 查询结果不明 --> 3/6/15/30/60 秒退避，只对账，不跨站重提
```

## 套餐与地区

后台映射的订单来源只能选择“商城交付”中已启用的 `membership_auto` 商品映射，并只能选择站点最近一次 `/config` 返回的 `taskType=purchase` 套餐和地区。商城交付映射的 `manualType` 必须与协议套餐类型完全一致，例如 `PLUS` 只能映射 `plus-monthly`，`x20` 只能映射 `pro20x-direct-monthly`。能力被站点移除、任务类型改变、地区币种变化或商城交付映射被修改时，相关自动化映射会停用。

- Plus、Go、x20 是否可用，以站点 `/config` 为准。
- x5 与 x20 都按直付商品处理，不先购买 Plus/Go，也不进入升级阶段。
- 当前 Automate V1 文档提供直付 Plus、Go、Pro 20x，没有直付 x5，因此该 Adapter 当前不能映射 x5。
- 后续站点如在其协议中明确提供直付 x5，可由对应 Adapter 原样暴露。

每条映射保存：

- 商城交付商品映射（远端商品 ID、SKU、`manualType`、站点）
- 外部站点与套餐
- 充值地区和币种
- 卡台、开卡产品、容量分组与单卡容量
- 整张卡初始预存金额
- 结账金额上下限
- 每日槽位风险上限
- 路由优先级和启用状态

## 路由和幂等

每个站点最大并发固定为 1。首个远端 attempt 使用本地订单号作为 `clientOrderId`，明确未创建任务后切换站点时使用 `订单号-2`、`订单号-3`。

商城交付生成会员卡密时，会把商城交付映射 ID 固化到卡密元数据和任务卡片快照。客户提交卡密后，自动化执行按这个来源 ID 精确路由，因此同一个 KaWang 站点下的 Plus 与 x20 不会因为共享本地商品而串单。升级前按旧本地商品创建的自动化映射会自动暂停为 `STORE_MAPPING_REQUIRED`，管理员必须重新选择商城交付商品并保存后才能启用。

只有远端明确返回“没有创建任务”才允许换站点。以下情况禁止跨站重提：

- 创建请求超时或网络结果不明
- 已返回远端 taskId
- 任务处于 queued/running
- 任务进入 manual_review
- 卡台开卡或充值结果不明

`automate_points_insufficient` 明确表示未创建任务。系统会暂停当前站点和映射、打开熔断，然后尝试下一条兼容映射。

如果第一次 attempt 已经为卡片建立资金意图，后续映射只能复用同一卡台、容量分组、卡产品，且整卡预存金额不能更高，避免为同一订单建立第二条资金边界。

整卡预存金额按容量分摊为订单槽位风险。Plus 配置为 80 USD、容量 5 时，每个订单占用 16 USD 日风险；开新卡只在第一个槽位一次预存 80 USD，后续槽位按剩余资金池目标 `64/48/32/16` 校验余额，不会在每个订单前补回 80 USD。x5/x20 配置容量 1 时，每个订单独占整张卡，槽位风险等于整卡预存金额。

## API Key

API Key 属于站点实例，不属于订单。管理员首次配置时提供一次，之后所有新订单复用当前 Key；编辑站点时留空表示继续使用。

站点协议没有 Key 轮换或 Key 查询 API，因此本系统不调用不存在的接口。管理员手动提供新 Key 后：

- 新任务使用新 Key。
- 已受理任务继续使用创建时快照的旧 Key 查询。
- 旧 Key 加密保留，不能被新订单选择。

## 敏感数据

- 站点 API Key 加密保存。
- Session 加密保存到订单终态；`manual_review` 保留，成功/失败/取消后立即清除。
- 完整卡号、CVC、有效期不写入自动化表、审计日志或远端快照。
- 只持久化卡片内部 ID、品牌和尾四位。
- 远端响应只保存 Adapter 白名单化后的任务字段。
- 自动化站点必须使用 HTTPS 固定 Origin；禁止凭据、query/hash、跨 Origin 重定向及私网/回环/链路本地地址。

## Gate 和熔断

全局付款 Gate 默认关闭。Gate 关闭时允许用 `GET /config` 检查站点能力，但禁止选卡、充值和 `POST /tasks`。已被远端受理的任务仍可继续 GET 对账。

以下问题会暂停映射或打开站点熔断：

- Key 无效或权限不足
- 站点积分不足
- 远端任务身份、套餐或地区与本地快照不一致
- 成功任务的价格未确认、币种不符、金额不可识别或超出映射范围
- 站点能力被移除

价格异常不会推翻已经返回 `succeeded` 的订单，只会完成当前订单后阻止后续订单继续使用该映射。

## 人工核验

`manual_review` 和提交结果不明对前台只显示“人工核验中”，不显示 provider、taskId、卡片或底层错误。后台显示脱敏时间线，可使用外部工单号或对账记录编号裁决：

- 裁决成功：CDK used、容量 consumed、Session 清除。
- 裁决失败：CDK active、容量 released、Session 清除。

人工核验默认不自动过期、不自动重试、不自动释放锁。首次进入人工核验及远端任务运行或查询异常超过 30 分钟时写入一次 `notification_events`；配置了全局飞书 Webhook 时同时发送脱敏提醒，之后每 60 秒继续查询原任务。

后台可对 `waiting_gate`、`waiting_mapping`、`waiting_capacity` 和 `preparing_card` 状态执行“立即重试”。该操作只把原执行的下一处理时间推进到当前时间，不创建新订单、不清除 attempt、不替换资金意图，也不能越过关闭的付款 Gate。已经提交或结果不明的状态不提供重试，只能使用原任务查询或人工对账。

`waiting_gate` 和 `waiting_mapping` 状态还可选择“人工处理”。人工接管只在没有远端任务、活动卡片预留、资金意图和 worker 活跃锁时成立；接管后自动流程冻结为 `manual_review`，管理员根据外部证据裁决成功或失败。接管发生在系统资金边界之前，因此外部已人工完成的订单可以在没有系统卡片预留的情况下裁决成功。

## 卡台资金边界

本地仍负责 SpaceX Card / EfunCard 的卡片选择、容量、开卡和充值。EfunCard 按参考协议执行本地频率限制，并校验产品金额范围、费率、最低平台余额、开卡总成本、充值 task 收据及最终余额。任何已受理但无法确认的资金操作都会进入人工核验，不会自动重放。

管理员作废卡密仅允许发生在 `waiting_gate` 或 `waiting_mapping`，并且订单不能已有卡片预留或资金意图。越过该边界后必须先完成对账。

## 旧流程迁移

- 新协议订单不创建 `membership_fulfillments`，也不创建 activation job。
- 旧 Go/Python/浏览器订单不自动迁移。
- 上线前先冻结旧 intake，核对所有已越过资金边界的旧订单，再停止旧服务。
- `KW1786762677460466` 有精确的 `NO_PAYMENT_MANUAL_HOLD` 排除规则；已有未终结记录也会补为 manual hold，并从旧 intake 中摘除。该订单不会自动付款。
