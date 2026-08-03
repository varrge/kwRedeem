# SpaceX Card 开放 API 文档

通过开放 API 程序化完成开卡、查卡、卡充值、退款、冻结、消费查询等操作。所有调用按你的账户余额与专属费率计费（与网页端一致）。

- **Base URL**：`https://spacexcard.com/openapi/v1`
- **数据格式**：请求与响应均为 `application/json`，UTF-8
- **凭证获取**：登录后在「开发者」页生成 `app_id` / `app_secret`

---

## 1. 接入流程

1. 在「开发者」页生成密钥，得到 `app_id`（`ak_` 开头，公开标识）与 `app_secret`（`sk_` 开头，请求鉴权用，务必保密）。
2. （可选）为密钥设置 IP 白名单、配置回调地址。
3. 调 `GET /products` 获取可开卡产品 → `POST /cards/open` 开卡（建议带幂等键）。
4. 用 `GET /cards/{id}` 取卡号/有效期/CVV，`GET /cards/{id}/transactions` 查消费，或配置 Webhook 实时接收卡事件。
5. `GET /balance` 查余额，`GET /balance-logs` 对账。

> 余额不足会导致开卡/充值失败。请先在网页端用 USDT 充值（支持 TRON / Ethereum / BNB Chain / X Layer）。

---

## 2. 鉴权

每个请求在 Header 携带 `app_secret`（`sk_` 开头），二选一：

```
X-API-Key: sk_xxxxxxxxxxxxxxxx
```
或
```
Authorization: Bearer sk_xxxxxxxxxxxxxxxx
```

可选：再带 `X-App-Id: ak_xxxx` 做双重校验。

- 密钥可在开发者页 **启用 / 停用**、设置 **IP 白名单**（仅允许指定 IP 调用）。
- 鉴权失败返回 `401`；IP 不在白名单返回 `403`。

---

## 3. 请求与响应格式

所有响应为 HTTP `200`，业务结果看 body 中的 `code`：

```jsonc
// 成功
{ "code": 0, "msg": "ok", "data": <结果> }
// 失败
{ "code": 400, "msg": "错误说明" }
```

| HTTP 状态 | 含义 |
|------|------|
| 200 | 请求已处理（以 body 内 `code` 为准，`0` = 业务成功）|
| 400 | 参数错误 / 业务失败（余额不足、卡不存在等，详见 `msg`）|
| 401 | 密钥无效 / 已停用 |
| 403 | IP 不在白名单 |
| 429 | 请求过于频繁，请退避后重试 |
| 500 | 服务端错误 |

**常见业务错误（`msg` 文案）**：余额不足、卡产品不存在或已下架、最低开卡金额限制、卡不存在、卡状态异常无法操作、退款金额超出卡内余额、退款后卡内余额不得少于 $1 等。

---

## 4. 幂等

开卡、充值、退款等写操作，带一个唯一的 `Idempotency-Key` 头：

```
Idempotency-Key: 你的唯一订单号
```

同一密钥下、相同 `Idempotency-Key` 的请求只会真正执行一次；重试会**原样返回首次结果**（响应头带 `Idempotent-Replayed: true`），可避免网络重试导致**重复开卡 / 重复扣费**。

---

## 5. 数据字典

**卡状态 `status`**

| 状态 | 说明 |
| --- | --- |
| ACTIVE | 激活（正常使用）|
| FROZEN | 已冻结 |
| CANCELLED | 已注销 |
| DELETED | 已删除 |

**交易类型 `type`**

| 类型 | 说明 |
| --- | --- |
| Authorization | 消费授权 |
| Settlement | 清算 |
| Refund | 消费退款 |
| Reversal | 授权撤销 |

**交易状态 `status`**

| 状态 | 说明 |
| --- | --- |
| PENDING | 清算中 |
| COMPLETE | 清算完成 |
| DECLINED | 交易失败（失败原因见 `description`）|

---

## 6. 接口详解

### 6.1 获取可开卡产品

`GET /products`

返回当前可开卡的产品列表，**含你的专属开卡费/退款率**。

**响应字段（`data` 数组项）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| product_code | string | 产品码（开卡用）|
| network | string | 卡组织：VISA / MasterCard |
| issuing_area | string | 发行区域 |
| card_type | string | 卡类型：save=储值卡 |
| open_fee | number | 开卡费（你的专属价）|
| recharge_fee | number | 卡充值手续费率 |
| rtf_rate | number | 消费退款手续费率 |
| min_amount | number | 最低开卡/充值金额 |
| max_amount | number | 最高金额 |

**请求**
```bash
curl https://spacexcard.com/openapi/v1/products -H "X-API-Key: sk_你的密钥"
```

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "product_code": "P5378OX",
      "issuer": "one",
      "network": "MasterCard",
      "issuing_area": "United States",
      "card_type": "save",
      "open_fee": 1.5,
      "recharge_fee": 0,
      "rtf_rate": 0.1,
      "min_amount": 10,
      "max_amount": 10000
    }
  ]
}
```

> `issuer` 为发卡渠道：`one` / `two`。两渠道卡段、发行地、费率可能不同，开卡时用对应 `product_code` 即可，无需关心底层差异；所有卡接口（充值/退款/冻结/删卡/查询）对两渠道通用。

---

### 6.2 开卡

`POST /cards/open`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| product_code | string | 是 | 产品码 |
| first_name | string | 是 | 持卡人名 |
| last_name | string | 是 | 持卡人姓 |
| init_amount | number | 是 | 初始充值金额（≥ 产品最低金额）|

开卡将从账户余额扣除 **开卡费 + 初始充值金额**。

**请求**
```bash
curl -X POST https://spacexcard.com/openapi/v1/cards/open \
  -H "X-API-Key: sk_你的密钥" \
  -H "Idempotency-Key: order-20260604-001" \
  -H "Content-Type: application/json" \
  -d '{"product_code":"P5378OX","first_name":"John","last_name":"Doe","init_amount":20}'
```

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "id": 123,
    "user_id": 31,
    "issuer": "one",
    "vm_card_id": "card55202606040031562947331",
    "card_number": "5378727109708264",
    "cvv": "123",
    "expire": "08/29",
    "product_code": "P5378OX",
    "network": "MasterCard",
    "issuing_area": "United States",
    "available_amount": 20,
    "status": "ACTIVE",
    "open_fee": 1.5,
    "first_name": "John",
    "last_name": "Doe",
    "created_at": "2026-06-04T00:31:56Z"
  }
}
```

> 开卡响应即时返回 `cvv` / `expire`（有效期 MM/YY），请妥善保存；后续 `GET /cards/{id}` 也可再取。卡列表接口出于安全不返回 CVV。

---

### 6.3 批量开卡

`POST /cards/batch-open`

在 6.2 参数基础上增加 `count`（开卡数量）。先预检总余额，再逐张开卡；单张失败自动退款并继续。

**请求**
```bash
curl -X POST https://spacexcard.com/openapi/v1/cards/batch-open \
  -H "X-API-Key: sk_你的密钥" -H "Content-Type: application/json" \
  -d '{"product_code":"P5378OX","first_name":"John","last_name":"Doe","init_amount":20,"count":3}'
```

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "success": [ { "id": 124, "card_number": "5378727100000001", "status": "ACTIVE" } ],
    "failed":  [ { "index": 2, "error": "余额不足" } ]
  }
}
```

---

### 6.4 我的卡列表

`GET /cards?page=1&page_size=20`

**请求参数**：`page`（页码，默认 1）、`page_size`（每页数量，默认 20）、`q`（按卡号/备注模糊搜索，选填）、`sync`（传 `1` 时实时同步当前页各卡余额/状态后再返回，便于核对“卡里还有多少钱”；不传则返回缓存值，更快）。

> `available_amount` 默认为缓存值（由 Webhook/消费回调更新，可能有滞后）。需要**实时余额**时加 `&sync=1`，系统会逐卡向上游查询当前页余额后返回（单卡 60 秒内最多同步一次，避免触发上游限速）。

**请求**
```bash
# 实时余额：加 sync=1（不加则返回更快的缓存值）
curl "https://spacexcard.com/openapi/v1/cards?page=1&page_size=20&sync=1" -H "X-API-Key: sk_你的密钥"
```

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "total": 2,
    "list": [
      {
        "id": 123,
        "vm_card_id": "card55202606040031562947331",
        "card_number": "5378727109708264",
        "product_code": "P5378OX",
        "network": "MasterCard",
        "issuing_area": "United States",
        "available_amount": 18.8,
        "status": "ACTIVE",
        "first_name": "John",
        "last_name": "Doe",
        "created_at": "2026-06-04T00:31:56Z"
      }
    ]
  }
}
```

---

### 6.5 卡详情（含卡号 / 有效期 / CVV）

`GET /cards/{id}`

`{id}` 为本地卡 ID。实时返回完整卡信息（含敏感字段）。

**响应字段（`data`）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| card_id | string | 卡 ID |
| card_number | string | 完整卡号 |
| cvv | string | CVV 安全码 |
| expire | string | 有效期 MM/YY |
| status | string | 卡状态 |
| user_name | string | 持卡人姓名 |
| available_amount | number | 卡内可用余额 |
| card_type | string | 卡类型 |
| first_name / last_name | string | 持卡人名 / 姓 |
| create_time | string | 开卡时间 |
| card_address | object | 账单地址 |
| limit | object | 额度设置（额度卡有效）|

**请求**
```bash
curl https://spacexcard.com/openapi/v1/cards/123 -H "X-API-Key: sk_你的密钥"
```

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "card_id": "card55202606040031562947331",
    "card_number": "5378727109708264",
    "cvv": "123",
    "expire": "08/29",
    "status": "ACTIVE",
    "user_name": "John Doe",
    "available_amount": 18.8,
    "card_type": "save",
    "first_name": "John",
    "last_name": "Doe",
    "create_time": "2026-06-04 00:31:56",
    "card_address": {
      "address_line_one": "",
      "address_line_two": "",
      "city": "",
      "state": "",
      "country": "",
      "post_code": ""
    }
  }
}
```

---

### 6.6 卡消费记录

`GET /cards/{id}/transactions?page=1&page_size=50`

**响应字段（`data` 数组项）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| auth_id | string | 交易 ID |
| auth_time | string | 交易授权时间 |
| auth_amount | number | 授权金额 |
| auth_currency | string | 授权币种 |
| settle_amount | number | 结算金额 |
| settle_currency | string | 结算币种 |
| status | string | 交易状态（见数据字典）|
| type | string | 交易类型（见数据字典）|
| merchant_name | string | 交易商户 |
| create_time | string | 创建时间 |
| description | string | 交易详情 / 失败原因 |

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "auth_id": "1059958172",
      "card_id": "card55202606040031562947331",
      "auth_time": "2026-06-04 02:29:40",
      "auth_amount": 9.99,
      "auth_currency": "USD",
      "settle_amount": 9.99,
      "settle_currency": "USD",
      "status": "COMPLETE",
      "type": "Settlement",
      "merchant_name": "OPENAI",
      "create_time": "2026-06-04 02:30:02",
      "description": ""
    },
    {
      "auth_id": "1059957962",
      "card_id": "card55202606040031562947331",
      "auth_time": "2026-06-04 02:20:34",
      "auth_amount": 5.00,
      "auth_currency": "USD",
      "settle_amount": 0,
      "settle_currency": "USD",
      "status": "DECLINED",
      "type": "Authorization",
      "merchant_name": "STEAM",
      "create_time": "2026-06-04 02:20:35",
      "description": "Insufficient funds"
    }
  ]
}
```

> 另有 `GET /cards/all-transactions` 一次性聚合你名下所有卡的消费记录（响应结构同上，每项额外带 `card_number`、`local_card_id`）。

---

### 6.7 卡段 OpenAI 最新支付（三档价位）

`GET /cards/{id}/openai-payments`

返回该卡**所属卡段**（卡头/BIN，渠道1/2 按产品、渠道3 按卡头）在 **OpenAI** 商户三个价位档（Plus / 5x / 20x）各自「最新一笔」支付的金额与时间，作为该卡段的**最新行情参考价**（用于参考下单）。取卡段而非单卡：新卡/未刷过某档的卡也能拿到该卡段的最新价。

**档位（按结算金额 USD 区间）**

| tier | label | 金额区间 |
| --- | --- | --- |
| plus | Plus | $15 – $20 |
| x5 | 5x | $90 – $100 |
| x20 | 20x | $140 – $160 |

**响应字段（`data` 数组，固定 3 项，按上表顺序）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| tier | string | 档位标识：plus / x5 / x20 |
| label | string | 档位名：Plus / 5x / 20x |
| min_usd | number | 档位下限（USD）|
| max_usd | number | 档位上限（USD）|
| amount | number | 该卡段该档最新一笔支付金额（USD），无则 0 |
| time | string | 该卡段该档最新一笔授权时间，无则空字符串 |
| found | boolean | 该档是否有匹配记录 |

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    { "tier": "plus", "label": "Plus", "min_usd": 15, "max_usd": 20, "amount": 16.24, "time": "2026-06-16 09:43:25", "found": true },
    { "tier": "x5", "label": "5x", "min_usd": 90, "max_usd": 100, "amount": 99.00, "time": "2026-06-15 20:11:03", "found": true },
    { "tier": "x20", "label": "20x", "min_usd": 140, "max_usd": 160, "amount": 150.00, "time": "2026-06-16 03:02:55", "found": true }
  ]
}
```

> 仅统计非拒付（成功 / 挂账）的 OPENAI 商户交易。某档无记录时 `found=false`、`amount=0`、`time=""`。

---

### 6.8 卡充值记录

`GET /cards/{id}/recharges`

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    {
      "id": 88,
      "user_id": 31,
      "card_id": 123,
      "vm_card_id": "card55202606040031562947331",
      "amount": 20,
      "fee": 0,
      "status": "success",
      "created_at": "2026-06-04T01:59:55Z"
    }
  ]
}
```

---

### 6.9 卡充值

`POST /cards/recharge`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| card_id | number | 是 | 本地卡 ID |
| amount | number | 是 | 充值金额 |

从账户余额扣除 `金额 + 手续费`（手续费 = 金额 × 卡充值费率）。

**请求**
```bash
curl -X POST https://spacexcard.com/openapi/v1/cards/recharge \
  -H "X-API-Key: sk_xxx" -H "Content-Type: application/json" \
  -d '{"card_id":123,"amount":50}'
```

**响应**
```json
{ "code": 0, "msg": "充值成功" }
```

---

### 6.10 卡退款（卡内余额退回平台余额）

`POST /cards/refund`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| card_id | number | 是 | 本地卡 ID |
| amount | number | 是 | 退款金额（≤ 卡内可用余额；退款后卡内余额需 ≥ $1）|

主动从卡退回平台余额**不收手续费**，全额到账。

**请求**
```bash
curl -X POST https://spacexcard.com/openapi/v1/cards/refund \
  -H "X-API-Key: sk_xxx" -H "Content-Type: application/json" \
  -d '{"card_id":123,"amount":10}'
```

**响应**
```json
{ "code": 0, "msg": "退款成功，余额已退回" }
```

---

### 6.11 冻结 / 解冻

`POST /cards/freeze`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| card_id | number | 是 | 本地卡 ID |
| freeze | boolean | 是 | true=冻结，false=解冻 |

**请求**
```bash
curl -X POST https://spacexcard.com/openapi/v1/cards/freeze \
  -H "X-API-Key: sk_xxx" -H "Content-Type: application/json" \
  -d '{"card_id":123,"freeze":true}'
```

**响应**
```json
{ "code": 0, "msg": "ok" }
```

---

### 6.12 删卡

`DELETE /cards/{id}`

永久删除卡，卡内剩余余额**全额退回**平台余额。

**请求**
```bash
curl -X DELETE https://spacexcard.com/openapi/v1/cards/123 -H "X-API-Key: sk_xxx"
```

**响应**
```json
{ "code": 0, "msg": "删卡成功，余额已退回" }
```

---

### 6.13 账户余额

`GET /balance`

**请求**
```bash
curl https://spacexcard.com/openapi/v1/balance -H "X-API-Key: sk_你的密钥"
```

**响应**
```json
{ "code": 0, "msg": "ok", "data": { "balance": 128.5, "currency": "USD" } }
```

---

### 6.14 账户流水（对账）

`GET /balance-logs?page=1&page_size=20`

**响应字段（`data.list` 项）**：`created_at` 时间、`type` 类型（recharge 充值 / open_card 开卡 / card_recharge 卡充值 / refund 退款 / decline_fee 消费失败手续费 / admin 调整 等）、`amount` 金额（正增负减）、`before`/`after` 变动前后余额、`remark` 备注。

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "total": 12,
    "list": [
      {
        "created_at": "2026-06-04T01:59:55Z",
        "type": "card_recharge",
        "amount": -20,
        "before": 38.8,
        "after": 18.8,
        "remark": "卡 5378727109708264 充值 $20.00 (手续费 $0.00)"
      }
    ]
  }
}
```

---

### 6.15 会员等级

`GET /vip`

返回当前账户的会员等级、累计数据与各档达标门槛。会员按**累计充值**自动达标（也可后台手动授予），达标后享更低开卡费与充值费率，高等级含低等级全部权益。

**等级（tier）**

| tier | 名称 | 达标（累计充值）| 权益（开卡费 / 充值费率 / 退款费）|
| --- | --- | --- | --- |
| `super` | 超级SVIP | ≥ $3,000 | $1 / 1% / 7% |
| `supreme` | 至尊SVIP | ≥ $20,000 | $0.5 / 1% / 5% |
| `legend` | 传奇SVIP | ≥ $100,000 | $0.5 / 0.8% / 3% |
| `none` | 普通 | — | 产品默认 / 全局默认 / 10%（港卡 15%）|

**响应字段（`data`）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| tier | string | `none` / `super` / `supreme` / `legend` |
| tier_name | string | 等级中文名 |
| is_svip | boolean | 是否超级SVIP 及以上 |
| is_supreme_svip | boolean | 是否至尊SVIP 及以上 |
| is_legend_svip | boolean | 是否传奇SVIP |
| active_cards | number | 名下有效卡数（仅供参考，不作为达标门槛）|
| cumulative_recharge | number | 累计充值（USDT，已入账）|
| recharge_fee_rate | number | 当前生效充值费率（如 0.01 = 1%）|
| thresholds.super / .supreme / .legend | object | 各档门槛 `{cards, recharge}`；当前仅按 `recharge` 达标，`cards` 恒为 `0` |

**响应**
```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "tier": "super",
    "tier_name": "超级SVIP",
    "is_svip": true,
    "is_supreme_svip": false,
    "is_legend_svip": false,
    "active_cards": 63,
    "cumulative_recharge": 4200.50,
    "recharge_fee_rate": 0.01,
    "thresholds": {
      "super": { "cards": 0, "recharge": 3000 },
      "supreme": { "cards": 0, "recharge": 20000 },
      "legend": { "cards": 0, "recharge": 100000 }
    }
  }
}
```

---

## 7. 回调 Webhook（卡事件推送）

配置回调地址后，你名下任意一张卡发生**授权 / 清算 / 退款 / 拒付 / 授权撤销**等事件时，平台都会主动 **POST** 一条事件到该地址，无需轮询即可实时对账。

> 目前仅推送**卡交易事件**（`event = card_transaction`）。开卡 / 冻结 / 删卡 / 充值 / 退款等由你主动调用的操作，以接口返回为准，不另发回调。
>
> 三个发卡渠道的事件已在平台侧**归一化**为下面同一套结构，接收端无需区分渠道。

### 7.1 配置回调地址

在「开发者」页填写回调地址并保存：

- 地址必须是有效的 **https** URL（不接受 `http`、`localhost`、内网 / 私有 IP；长度 ≤ 256）。
- **首次**保存回调地址时，系统自动生成签名密钥 `webhook_secret`（形如 `whsec_xxxx…`），在开发者页可见，用于校验请求来源（见 7.5）。
- 清空回调地址即停止推送。

### 7.2 请求

| 项 | 值 |
| --- | --- |
| 方法 | `POST` |
| Content-Type | `application/json` |
| 请求头 | `X-Signature`：请求体的 HMAC-SHA256 签名（见 7.5）|
| 期望响应 | HTTP `2xx`；其它状态码或超时（约 10s）视为失败并重试 |

**请求体（JSON）**
```json
{
  "event": "card_transaction",
  "auth_id": "1059958172",
  "vm_card_id": "card55202606040031562947331",
  "card_id": 123,
  "card_number": "5378721234568264",
  "settle_amount": 9.99,
  "status": "COMPLETE",
  "type": "Settlement"
}
```

### 7.3 事件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event` | string | 事件类型，目前固定为 `card_transaction`（卡交易）|
| `auth_id` | string | 上游交易 / 授权唯一号，**幂等键**（见 7.6）|
| `vm_card_id` | string | 卡在系统内的上游卡标识 |
| `card_id` | number | 卡在平台的数字 ID（对应 `GET /cards/{id}`）|
| `card_number` | string | **完整卡号**（请按需妥善保管，勿明文落日志）|
| `settle_amount` | number | 结算金额（USD，正数）。清算 / 退款为实际金额；授权与拒付可能为 `0` |
| `status` | string | 交易状态：`PENDING` / `COMPLETE` / `DECLINED`（见 [§5 数据字典](#5-数据字典)）|
| `type` | string | 交易类型：`Authorization` / `Settlement` / `Refund` / `Reversal`（见 [§5 数据字典](#5-数据字典)）|
| `merchant` | string | 商户名。**附加字段，部分事件才有**，不保证每条都存在 |
| `channel` | string | 渠道内部标记（如 `two`）。**附加字段**，可忽略 |

> 稳定契约以 `event`、`auth_id`、`vm_card_id`、`card_id`、`card_number`、`settle_amount`、`status`、`type` 这 8 个字段为准。`merchant` / `channel` 为附加信息，接收端**不应强依赖**。

### 7.4 事件场景对照（type × status）

| type | status | 含义 | 对卡余额 |
| --- | --- | --- | --- |
| `Authorization` | `PENDING` | 消费授权成功，预扣（冻结）额度，尚未清算 | 占用可用额度 |
| `Settlement` | `COMPLETE` | 清算完成，真实扣款落地 | 扣减 |
| 任意 | `DECLINED` | 交易被拒（余额不足 / 风控等）| 不变 |
| `Refund` | `COMPLETE` / `PENDING` | 消费退款，金额退回卡内 | 增加 |
| `Reversal` | `COMPLETE` | 授权撤销（预授权取消，非真实退款）| 释放占用 |

> 一笔消费通常先收到 `Authorization` / `PENDING`，清算后再收到 `Settlement` / `COMPLETE`，两条 `auth_id` 相同——按 7.5 幂等去重。

### 7.5 签名校验（务必校验）

`X-Signature` = `HMAC-SHA256(webhook_secret, 原始请求体字节)` 的**十六进制小写**串。必须用**原始 body** 计算（不要先反序列化再重新序列化，否则字节不一致导致校验失败），并用常量时间比较：

```js
const crypto = require('crypto')
// 用 raw body（Buffer），不要用已解析的对象
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const expect = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.body).digest('hex')
  const got = req.headers['x-signature'] || ''
  const ok = expect.length === got.length &&
    crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(got))
  if (!ok) return res.status(401).end()

  const evt = JSON.parse(req.body.toString('utf8'))
  // TODO: 按 evt.auth_id 幂等处理
  res.status(200).end()
})
```

### 7.6 投递、重试与幂等

- **异步投递**，不阻塞上游事件处理；每次投递超时约 10 秒。
- 未收到 `2xx` 会**退避重试**，最多共 3 次（间隔约 `2s`、`4s` 递增）；仍失败则丢弃该次投递（不会无限重投）。
- 接收端应**尽快返回 2xx**（重活丢队列异步做），否则易触发重试与重复投递。
- **幂等**：同一 `auth_id` 可能因状态流转（`PENDING`→`COMPLETE`）或重试被投递多次。请以 `auth_id`（如需区分阶段再叠加 `type` + `status`）去重，切勿重复入账。
- **不保证严格顺序**：极端情况下 `COMPLETE` 可能早于 `PENDING` 到达，请以最终态为准。

### 7.7 安全建议

- 只接受 `https`；先校验 `X-Signature` 再处理，拒绝签名不符的请求。
- `card_number` 是完整卡号，按合规要求存储 / 传输，切勿写入明文日志或转发到不可信下游。
- 平台仅从公网地址回源，回调地址不可指向内网 / 本机。

---

如需协助，请在「开发者」页联系客服或加入开发者群。
