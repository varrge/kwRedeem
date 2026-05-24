# 提号系统 API 接口文档

本文档汇总"提号系统"（quota）所有公开和后台 API 接口、字段定义、状态机、外部依赖与已知坑位。

实现位置：`api/src/server.js`、`shared/src/quota-api.js`、`shared/src/constants.js`、`shared/src/database.js`。

## 1. 系统概览

提号系统由两层卡密构成：

| 概念 | 表 | 说明 |
| --- | --- | --- |
| 源卡密 (source card) | `quota_source_cards` | 真正向外部接口（kedaya）申请提号的"母卡"。由 admin 导入 / 合并产生。 |
| 子卡密 (sub card) | `quota_sub_cards` | 发给最终用户的"子卡"。用户拿子卡密调 `claim` 提号，`claim` 在内部选一张源卡密向外部提号 API 扣量。 |
| 提号日志 | `quota_claim_logs` | 每次成功 `claim` 留一条流水，包含金额、账号、IP。 |
| 频控 | `quota_rate_limits` | 子卡密 `claim` 频控计数。 |
| 导入批次 | `quota_import_batches` | admin 导入源卡密的批次记录。 |

数据流：
```
外部 kedaya 接口 ──verifyExternalCard──▶ 导入源卡密 ──mergeExternalCards──▶ 合并源卡密
                                                                       │
            ┌────────────claimFromExternal──── POST /api/public/quota/claim ─── 用户子卡密
            │
            ▼
        外部扣量
```

## 2. 公共枚举与常量

### 2.1 源卡密状态 `quotaCardStatuses`
| 值 | 含义 |
| --- | --- |
| `active` | 可被 `claim` 选中（前提 `remaining > 0`，见 §6.5 修复） |
| `used` | 已被合并掉的旧卡，或被外部耗尽（仅由合并流程标记，外部耗尽不会自动改这个字段） |
| `failed` | 导入或验证时验证失败 |

### 2.2 子卡密状态 `quotaSubCardStatuses`
| 值 | 含义 |
| --- | --- |
| `active` | 可使用 |
| `locked` | 触发频控被锁定（`locked_until` 之前不可用，过期自动解锁） |
| `void` | 已取消 |

### 2.3 导入批次状态 `quotaBatchStatuses`
`pending` / `completed` / `partial`。

### 2.4 错误码 `quotaErrorCodes`
| code | 含义 |
| --- | --- |
| `CARD_EXISTS` | 源卡密重复导入 |
| `CARD_INVALID` | 卡密不存在 / 已作废 |
| `CARD_EXHAUSTED` | 子卡剩余额度不足 |
| `QUOTA_INSUFFICIENT` | 创建子卡时系统总可分配额度不足 |
| `VALIDATION_ERROR` | 入参校验失败 |
| `RATE_LIMITED` | 触发频控（窗口 60s，阈值 10，锁 30 分钟） |
| `CARD_LOCKED` | 子卡处于 locked 状态 |
| `EXTERNAL_API_ERROR` | 外部接口失败 / 系统无可用源卡密 / 解密失败 |
| `CANCEL_DENIED` | 取消子卡被拒（locked 状态） |

### 2.5 频控常量
- `QUOTA_RATE_LIMIT_WINDOW = 60`（秒）
- `QUOTA_RATE_LIMIT_MAX = 10`（次/窗口）
- `QUOTA_LOCK_DURATION_MINUTES = 30`

## 3. 公共接口（无需鉴权）

> 这些接口被 web 前端 `/quota.html` 直接调用。

### 3.1 验证子卡密 — `POST /api/public/quota/verify`

请求体
```json
{ "cardCode": "string" }
```

成功 200
```json
{ "valid": true, "cardCode": "...", "remaining": 100 }
```

失败
- 400 `VALIDATION_ERROR`
- 401 `CARD_INVALID`（卡密不存在）
- 403 `CARD_INVALID`（status=void）
- 429 `CARD_LOCKED`（status=locked）

### 3.2 子卡密信息 — `GET /api/public/quota/info?cardCode=`

成功 200
```json
{
  "remaining": 100,
  "totalQuota": 200,
  "usedQuota": 100,
  "availableStock": 9999
}
```
`availableStock` 来自全部源卡密 `remaining` 之和（`getAvailableQuota`）。

错误：400 / 401 / 429（同上）。

### 3.3 提号警告（外部接口透传） — `GET /api/public/quota/claim-warning`

直接代理外部 `GET /api/claim-warning`，5s 超时；任何失败都返回 `{ "warning": null }`，不暴露错误。

成功
```json
{ "warning": { "id": "...", "title": "...", "message": "..." } }
```

### 3.4 提号 — `POST /api/public/quota/claim`

请求体
```json
{ "cardCode": "string", "count": 1, "warningAckId": "" }
```

成功 200
```json
{
  "success": true,
  "remaining": 99,
  "chargedQuota": 1,
  "accounts": ["acct@x.com:pwd", "..."]
}
```

失败
| 状态 | code | 触发条件 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 入参缺失 |
| 401 | `CARD_INVALID` | 子卡不存在或 void |
| 403 | `CARD_EXHAUSTED` | 子卡 remaining < count |
| 429 | `RATE_LIMITED` | 子卡被锁 / 命中频控（顺便把卡锁 30 分钟） |
| 500 | `EXTERNAL_API_ERROR` | "系统无可用源卡密" / "源卡密解密失败" |
| 502 | `EXTERNAL_API_ERROR` | 外部接口抛错 / 返回 ok=false |

执行步骤（参考代码 ~4707）：

1. 子卡查找 + locked 自动解锁判断
2. 频控查询（60s 窗口）
3. 频控计数 +1（必要时插入新窗口）
4. 子卡剩余额度检查（`total_quota - used_quota >= count`）
5. **源卡密选择 SQL**（修复后）
   ```sql
   SELECT id, source_key FROM quota_source_cards
   WHERE status = 'active' AND remaining > 0
   ORDER BY created_at ASC
   LIMIT 1;
   ```
   未命中 → 500 `系统无可用源卡密`。
6. `decryptText(source_key)` → 失败 500 `源卡密解密失败`
7. `claimFromExternal(code, count, warningAckId)`
8. `ok=true` → `quota_sub_cards.used_quota += chargedQuota` + 写 `quota_claim_logs`，返回 success；`ok=false` 或抛错 → 502，不修改任何本地状态

> ⚠️ **已知缺陷（待修）**：步骤 8 不会回写 `quota_source_cards.remaining`。本地 remaining 会和外部漂移，依赖 §4.5 verify 端点也无法纠正（见 §6.4）。

### 3.5 提号历史 — `GET /api/public/quota/history?cardCode=`

成功 200
```json
{
  "history": [
    {
      "id": "...",
      "amount": 1,
      "accountCount": 1,
      "accounts": ["..."],
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 3.6 提号历史下载 — `GET /api/public/quota/history/download?cardCode=`

返回 `text/plain`，attachment 文件名 `quota-history-{cardCode}.txt`。内容由 `generateExportText` 生成。

## 4. 后台接口（需 admin 鉴权）

> 全部需要 `requireAdmin` preHandler；前端 `admin/app.js` 调用。

### 4.1 仪表板 — `GET /api/admin/quota/dashboard`

```json
{
  "totalQuota": 9999,
  "allocatedQuota": 1000,
  "availableQuota": 8999,
  "activeSubCards": 12,
  "totalClaims": 345
}
```
- `totalQuota`：所有源卡密 `remaining` 之和
- `allocatedQuota`：全部 active/locked 子卡的 `total_quota - used_quota` 之和
- `availableQuota = totalQuota - allocatedQuota`

### 4.2 源卡密列表 — `GET /api/admin/quota/cards`

Query：`page`、`pageSize`（默认 1 / 20，上限 100）、`status` ∈ `active|used|failed`。

```json
{
  "cards": [
    {
      "id": "...",
      "sourceKey": "ABCD****WXYZ",
      "quota": 100,
      "remaining": 50,
      "status": "active",
      "importBatchId": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```
`sourceKey` 为掩码，前 4 + `****` + 后 4。

### 4.3 导入源卡密 — `POST /api/admin/quota/cards/import`

请求体
```json
{ "cards": ["code1", "code2"] }
```
1–100 张；批次内或与历史已存在的卡密 → 409 `CARD_EXISTS`。

每张卡走 `verifyExternalCard`：
- `ok=true && remaining>0` → 插入 `status=active`
- 否则 → 插入 `status=failed` 并填 `last_error`

有效卡密 ≥ 2 张时**自动**调一次 `mergeExternalCards`，将原有卡标记为 `used` 并写入合并后的新 active 卡（schema 与手动合并端点一致）。

成功 200
```json
{
  "successCount": 2,
  "failureCount": 0,
  "failures": [],
  "mergeResult": {
    "success": true,
    "mergedCardId": "...",
    "newCode": "MERGED_PLAINTEXT",  // 注意：导入路径返回的是明文，未掩码
    "totalRemaining": 200
  }
}
```
合并失败时 `mergeResult = { success: false, error: "..." }`，原卡保持 active。

### 4.4 手动合并源卡密 — `POST /api/admin/quota/cards/merge`

请求体
```json
{ "cardIds": ["id1", "id2", ...] }
```

校验：
- cardIds 非空
- 全部存在
- 全部 `status=active`

调 `mergeExternalCards(cardCodes)`：
- 成功：插入合并后的 active 卡，原卡 `status=used` 并写 `merged_into_id`
- 失败：保持原状态，返回 400

成功 200
```json
{
  "success": true,
  "mergedCardId": "...",
  "newCode": "ABCD****WXYZ",
  "totalRemaining": 200
}
```
`newCode` 为掩码（>8 字符时前 4+****+后 4，否则 `****`）。

失败 400
```json
{ "success": false, "error": "...", "code": "EXTERNAL_API_ERROR" }
```

> ⚠️ **典型错误**："输入卡密没有可合并的剩余额度" — 这是外部 `/api/merge-cards` 的拒绝。当前手动合并入口未按 `remaining > 0` 过滤，参与合并的若有耗尽卡，外部就拒绝。详见 §6.3。

### 4.5 验证 / 刷新源卡密额度 — `POST /api/admin/quota/cards/verify`

请求体
```json
{ "cardId": "..." }
```

按 `cardId` 查源卡密，解密后调 `verifyExternalCard(code)`，**只**透传外部返回，不修改任何 DB 字段。

成功 200
```json
{ "ok": true, "quota": 100, "remaining": 50, "used": false }
```

失败：400（VALIDATION_ERROR）/ 404（CARD_INVALID）/ 500（解密失败）/ 502（外部抛错）。

> ⚠️ **典型问题**：本端点叫"刷新"，但**不会**写回 `quota_source_cards.remaining`。所以 admin 页面看到的 remaining 仍然是导入时的旧值，永远不会随外部状态更新。详见 §6.4。

### 4.6 创建子卡密 — `POST /api/admin/quota/sub-cards`

请求体
```json
{ "quota": 100, "count": 5 }
```
- `quota` ∈ [1, 999999]
- `count` ∈ [1, 100]
- `quota * count` 不能超过 `availableQuota`，否则 400 `QUOTA_INSUFFICIENT`

成功 200
```json
{
  "success": true,
  "count": 5,
  "cards": [
    {
      "id": "...",
      "cardCode": "...",
      "totalQuota": 100,
      "status": "active",
      "createdAt": "..."
    }
  ]
}
```

### 4.7 子卡密列表 — `GET /api/admin/quota/sub-cards`

Query：`page`、`pageSize`、`status` ∈ `active|locked|void`。

```json
{
  "subCards": [
    {
      "id": "...",
      "cardCode": "...",
      "totalQuota": 100,
      "usedQuota": 0,
      "status": "active",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 4.8 子卡密详情 — `GET /api/admin/quota/sub-cards/:id`

```json
{
  "id": "...",
  "cardCode": "...",
  "totalQuota": 100,
  "usedQuota": 10,
  "remaining": 90,
  "status": "active",
  "lockedAt": null,
  "lockedUntil": null,
  "lockReason": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```
404 `CARD_INVALID` 当 id 不存在。

### 4.9 子卡密提号历史 — `GET /api/admin/quota/sub-cards/:id/history`

```json
{
  "history": [
    {
      "id": "...",
      "amount": 1,
      "accountCount": 1,
      "accounts": ["..."],
      "warningAckId": "...",
      "sourceIp": "127.0.0.1",
      "createdAt": "..."
    }
  ]
}
```

### 4.10 取消子卡密 — `POST /api/admin/quota/sub-cards/:id/cancel`

将子卡 `status=void`，返回额度 = `total_quota - used_quota`。

- 404 `CARD_INVALID`：id 不存在
- 409 `CANCEL_DENIED`：status=locked
- 400：status=void

成功 200
```json
{
  "success": true,
  "returnedQuota": 90,
  "cardCode": "...",
  "newStatus": "void"
}
```

会写一条 `audit_log`：`action=quota_sub_card_cancel`。

### 4.11 系统设置 — `GET /api/admin/quota/settings`

```json
{
  "lowStockThreshold": 5,
  "updatedAt": "...",
  "updatedBy": "admin"
}
```

### 4.12 更新系统设置 — `PATCH /api/admin/quota/settings`

请求体
```json
{ "low_stock_threshold": 5 }
```
必须为正整数 ≥ 1，否则 400 `VALIDATION_ERROR`。

```json
{
  "id": "default",
  "lowStockThreshold": 5,
  "updatedAt": "...",
  "updatedBy": "admin"
}
```

## 5. 外部接口（kedaya）

封装在 `shared/src/quota-api.js`，所有错误信息会被 `sanitizeError` 把外部域名替换为 `[external-api]`。

| 函数 | 方法 | 路径 | 超时 |
| --- | --- | --- | --- |
| `verifyExternalCard(code)` | POST | `/api/card-info` | 15s |
| `mergeExternalCards(codes)` | POST | `/api/merge-cards` | 30s |
| `fetchClaimWarning()` | GET | `/api/claim-warning` | 5s |
| `claimFromExternal(code, count, warningAckId)` | POST | `/api/claim` | 15s |
| `fetchClaimHistory(code)` | GET | `/api/claim-history?cardCode=` | 15s |

请求 / 响应见对应函数注释。

## 6. 已知缺陷与坑位

### 6.1 ✅ Step 5 选源卡漏过滤 `remaining`（已修）

修复：`WHERE status='active' AND remaining > 0 ORDER BY created_at ASC LIMIT 1`。
spec：`.kiro/specs/quota-claim-source-card-selection/`。

### 6.2 ✅ 自动合并阈值（早先修）

导入流程在有效卡 ≥ 2 张时自动合并；旧版要求 > 2 是历史 bug。

### 6.3 ⚠️ 手动合并报 "输入卡密没有可合并的剩余额度"（待修）

**现象**：勾选两张及以上 active 卡 → 后端返回
```json
{ "success": false, "error": "输入卡密没有可合并的剩余额度", "code": "EXTERNAL_API_ERROR" }
```

**根因**：`POST /api/admin/quota/cards/merge` 只校验 `status='active'`，没校验 `remaining > 0`。本地 remaining 由于 §6.4 永远是旧值，即便本地 remaining > 0，外部的真实余额可能已经为 0。任意一张被外部判定耗尽，`mergeExternalCards` 就拒绝整批。

**修复方向**（任选/合并）：
1. **后端**：合并前先对每张卡调 `verifyExternalCard` 拿外部 `remaining`；过滤掉 `remaining=0` 的卡，剩余张数 < 2 则提示用户"没有可合并的有效卡"，不调外部合并。
2. **后端**：`WHERE status='active' AND remaining > 0`，并配合 §6.4 把刷新做成"写回本地"。
3. **前端**：`admin/app.js#renderQuotaSourceCards` 列表里只勾选 remaining > 0 的卡，把已耗尽卡的 checkbox 禁用。

推荐方案：1 + 3 的组合。后端把"先 verify、再过滤、再 merge"做成事务，前端 UI 同步禁用耗尽卡。

### 6.4 ⚠️ 刷新额度不写回本地（待修）

**现象**：`POST /api/admin/quota/cards/verify` 注释明确说"do NOT modify any DB status — verify is purely informational"。所以 admin 页面"刷新额度"按钮不会改 `quota_source_cards.remaining`，列表显示永远是导入时的旧值，即便外部已经被耗尽。

**根因**：当前实现把 verify 当作只读探针。但前端文案是"刷新额度"，用户预期是把外部状态写回本地。

**修复方向**：
1. 在 verify 端点拿到 `result.remaining` 后，`UPDATE quota_source_cards SET remaining = ?, updated_at = ? WHERE id = ?` 写回本地。
2. 同时考虑把 `result.used=true` 或 `result.remaining=0` 的卡 `status` 更新为 `failed`（或新加 `exhausted`），让 §3.4 Step 5 选卡更精确。注意改 status 可能影响"合并 UI"和"列表过滤"，需评估范围。
3. `POST /api/public/quota/claim` 步骤 8 也应在拿到外部 `remaining` 后回写源卡密本地 remaining，从源头消除漂移。

> 这两处一起修才是闭环：claim 时实时同步外部 remaining，verify 按钮明确写回，merge 端点信任本地 remaining。

### 6.5 ℹ️ 源卡密 `status` 在 claim 路径不会变更

外部把卡密耗尽后，本地 `status` 仍是 `active`、`remaining` 仍是旧值。修 §6.4 后建议同时让 `claim` 在 ok=false / `remaining=0` 等明确耗尽信号下把卡密迁出 active 集合（`status='failed'` 或 `'used'`），避免重复选中。

## 7. 关联文件速查

| 关注点 | 文件 |
| --- | --- |
| 全部路由 | `api/src/server.js` 行 ~3838 起 |
| 外部封装 | `shared/src/quota-api.js` |
| 枚举 / 频控常量 | `shared/src/constants.js` |
| 表结构 | `shared/src/database.js` |
| 额度计算 | `shared/src/quota-calc.js`（`getTotalQuota` / `getAllocatedQuota` / `getAvailableQuota`） |
| 加解密 | `shared/src/secure.js`（`encryptText` / `decryptText`） |
| 后台前端 | `admin/app.js`、`admin/index.html`（搜索 `quota`） |
| 用户前端 | `web/quota.html`、`web/app.js` |
