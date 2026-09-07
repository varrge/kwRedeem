# Sub2API v0.1.137 → v0.1.184 升级评估

> 核查日期：2026-08-31（Asia/Shanghai）
>
> 核查范围：官方仓库 `Wei-Shaw/sub2api` 的 Release、Tag、Commit、源码、数据库迁移和部署文件。
>
> 本文只评估官方远端；未拉取、切换或修改本地 `sub2api/`。

## 结论

`v0.1.137` 已明显过旧，而且处于官方披露的高危漏洞影响范围内，不建议继续用于生产。不过，本次对 `https://sub.vsakura.top/api/v1/settings/public` 的只读核查返回 `version: 0.1.184`：当前生产已经是核查当日的最新正式版，**生产无需再次升级**。现在落后的是本地 `sub2api/` 参考仓库，而不是线上服务。

建议把本地参考仓库和后续自维护 fork 的目标版本定为正式标签 `v0.1.184`；将来部署则使用固定镜像 `weishaw/sub2api:0.1.184` 并记录 digest，不要直接使用浮动的 `latest`。如果另有环境确实仍运行 `v0.1.137`，应先在生产数据库副本上完成迁移和 kwRedeem 集成回归，再在维护窗口尽快升级。

从迁移机制看，可以由当前基线直接跳到 `v0.1.184`，没有发现必须逐版本升级的要求。但这是一个包含 85 个新增 SQL 迁移、多个计费语义变化的跨版本升级，必须先备份并演练，不能只换镜像后观察。

## 版本跨度

| 项目 | 结果 |
| --- | --- |
| 当前本地参考基线 | `4a5665da5b2c6b83c4597844ea6e573746c821b1`，即 `chore: sync VERSION to 0.1.137` |
| 当前线上版本 | `sub.vsakura.top` 公开设置接口于核查时返回 `v0.1.184` |
| `v0.1.137` 发布提交 | `eba9bea959dad0c6db30994870c60085965e2fd5` |
| `v0.1.137` 发布时间 | 2026-06-16 20:59（Asia/Shanghai） |
| 最新正式版 | `v0.1.184`，非 draft、非 prerelease |
| `v0.1.184` 发布提交 | `e98ef32eb29aecd30d1def615912ec4dc93173f3` |
| `v0.1.184` 发布时间 | 2026-08-31 17:27（Asia/Shanghai） |
| 正式版跨度 | `v0.1.137` 之后已有 42 个正式 Release |
| 提交跨度 | 当前基线 `4a5665da5` 到 `v0.1.184` 相差 2461 个提交 |

官方比较页：[4a5665da5...v0.1.184](https://github.com/Wei-Shaw/sub2api/compare/4a5665da5...v0.1.184)。`v0.1.184` 标签后的官方 `main` 仅多出同步 `VERSION` 到 `0.1.184` 的提交 [`52374af94031`](https://github.com/Wei-Shaw/sub2api/commit/52374af94031f04df8de6fc91deb77a179e04b06)，因此本地同步和未来构建都应基于正式标签而非 `main`。

## 为什么需要尽快升级

1. **`v0.1.137` 明确受高危漏洞影响。** 官方安全公告 [GHSA-vrxq-qm4h-6hgg / CVE-2026-73079](https://github.com/Wei-Shaw/sub2api/security/advisories/GHSA-vrxq-qm4h-6hgg) 标记严重度为 High，影响 `>= 0.1.135, <= 0.1.168`。已认证租户可利用 Responses 子路径的路径校验缺陷，借助池内账号凭据向任意上游端点中继请求。官方在 [`v0.1.169`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.169) 明确建议受影响版本尽快升级。
2. **后续还有账号接管修复。** [`v0.1.172`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.172) 修复 OAuth 登录补全流程的高危账号接管：攻击者此前可能仅凭受害者邮箱把自己的第三方身份绑定到受害者账户。
3. **计费、余额和支付正确性有多项修复。** 包括高并发用量日志不再静默丢失（[`v0.1.144`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.144)）、余额与订阅并发加固（[`v0.1.150`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.150)）、流中断用量漏计修复和支付设置局部更新修复（[`v0.1.170`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.170)）、订阅并发续期、退款资金缺口和 Stripe 重复退款修复（[`v0.1.171`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.171)）、充值完成后余额及时刷新（[`v0.1.182`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.182)），以及支付回调相对地址和充值汇率币种展示修复（[`v0.1.184`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.184)）。

## 主要功能与行为变化

对当前项目较有价值的变化包括：

- 用量记录和查询持续增强：请求类型、会话 ID、图片输入成本、长上下文计费标记、上游实际模型、模型不一致、原生 compaction v2、客户端原始推理强度等字段和筛选；`v0.1.179` 又优化了大表查询。[v0.1.179 Release](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.179)、[v0.1.184 Usage DTO](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/dto/types.go)
- `v0.1.143` 增加分组高峰时段倍率，`v0.1.157` 增加上游计费倍率探测，`v0.1.170` 增加分组利润控制与账号倍率自动同步，`v0.1.179` 增加渠道 Fast/Flex 和区间倍率。这些是上游/分组定价能力，不等同于单用户限时充值返赠。[v0.1.143](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.143)、[v0.1.157](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.157)、[v0.1.170](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.170)、[v0.1.179](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.179)
- 订阅支持撤销后恢复，并修复软删除、配额刷新和并发续期问题。[v0.1.142](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.142)、[v0.1.143](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.143)、[v0.1.171](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.171)
- 管理面增加审计日志、敏感操作 step-up 2FA、客户端真实 IP 配置等安全能力。[v0.1.157](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.157)、[v0.1.161](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.161)、[v0.1.162](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.162)

## 破坏性变化与上线前检查

| 版本 | 官方标注的变化 | 对本项目的影响 |
| --- | --- | --- |
| `v0.1.171` | 管理员退款时，若用户余额不足，不再只扣可用余额后仍全额退款；接口返回 `require_force`，需显式确认 | kwRedeem 当前不调用退款接口，无直接影响；以后接入退款时必须适配 |
| `v0.1.173` | Grok 跨厂商模型映射默认关闭；邮箱密码登录硬禁用；迁移 220 清理非 Grok 分组的视频定价残值 | 如在用 Grok，升级前导出并核对映射和历史定价 |
| `v0.1.177` | Codex OAuth 指纹收敛默认改为关闭 | 需要旧收敛行为的账号必须显式选择档位 |
| `v0.1.179` | 长上下文计费门控由“分组 AND 账号”改为“分组 OR 账号” | **必须检查。** 存量 OpenAI 请求超过 272k 上下文时，可能开始按输入 `2×`、输出 `1.5×` 计费；如要维持旧口径，应按官方说明关闭相关分组的 `long_context_pricing_enabled` |

来源：[`v0.1.171`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.171)、[`v0.1.173`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.173)、[`v0.1.177`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.177)、[`v0.1.179`](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.179)。

## 数据库迁移评估

- `v0.1.137` 含 188 个 SQL 迁移，`v0.1.184` 含 273 个，新增 85 个。
- 对比官方两个标签的 Git Tree 后，两版共有的 188 个迁移文件 blob SHA 全部一致；未发现旧迁移被改写。
- 官方迁移器在服务启动时取得 PostgreSQL advisory lock，按文件名字典序执行尚未应用的迁移，并在 `schema_migrations` 保存文件名、SHA-256 校验和和应用时间。普通 `.sql` 在事务中执行，`*_notx.sql` 用于 `CREATE/DROP INDEX CONCURRENTLY`。[迁移说明](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/migrations/README.md)、[迁移器源码](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/repository/migrations_runner.go)
- 迁移是 forward-only。升级后若要回退，必须同时恢复升级前 PostgreSQL 备份；只把镜像切回 `0.1.137` 不是可靠回退。
- `v0.1.179` 的 [`226_add_usage_log_effective_model_indexes_notx.sql`](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/migrations/226_add_usage_log_effective_model_indexes_notx.sql) 会在 `usage_logs` 上 `CONCURRENTLY` 创建两个表达式索引。不会像普通建索引那样阻塞正常读写，但官方提示千万级数据量可能耗时较长，应在数据库副本上记录耗时，并为上线窗口设置足够的 `SETUP_MIGRATION_TIMEOUT_SECONDS`。
- 后续 `231` 迁移为用量表增加 compaction 和请求推理强度字段，均为向后兼容的新增列。[native compaction](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/migrations/231_add_usage_log_native_compaction_v2.sql)、[requested reasoning effort](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/migrations/231_add_usage_log_requested_reasoning_effort.sql)

## Docker 与部署变化

官方 Compose 的数据库基础镜像在这两个版本间没有改变：PostgreSQL 仍为 `postgres:18-alpine`，Redis 仍为 `redis:8-alpine`。但不建议只替换应用镜像；新版部署文件还有以下重要变化：

- 应用容器增加 `security_opt: no-new-privileges:true`，对应 `v0.1.169` 的安全加固。
- 修复 Redis 持久化启动命令：旧 Compose 的多行 `sh -c` 实际可能只运行无参数的 `redis-server`，新版用反斜杠把 `--save`、`--appendonly yes`、`--appendfsync everysec` 正确传入。
- 增加 `REDIS_USERNAME`、`SETUP_MIGRATION_TIMEOUT_SECONDS`、`UPDATE_GITHUB_TOKEN` 及多项网关参数。
- 本地目录版 Compose 为挂载增加 `:Z`，适配 SELinux。
- `v0.1.145` 起，示例 Compose 在关闭 allowlist 时默认允许 HTTP 和私有地址，官方称其为开发友好默认值。生产环境必须显式审查并按实际上游收紧 `SECURITY_URL_ALLOWLIST_ALLOW_INSECURE_HTTP` 与 `SECURITY_URL_ALLOWLIST_ALLOW_PRIVATE_HOSTS`，不要无意识继承更宽松的默认值。
- 官方构建工具链从 Go `1.26.4` 更新为 `1.27.0`；使用官方镜像不需要自行处理，自建镜像则应同步。

来源：[v0.1.137 Compose](https://github.com/Wei-Shaw/sub2api/blob/v0.1.137/deploy/docker-compose.yml)、[v0.1.184 Compose](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/deploy/docker-compose.yml)、[本地目录版 Compose](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/deploy/docker-compose.local.yml)、[v0.1.184 Dockerfile](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/Dockerfile)、[部署说明](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/deploy/README.md)。

## kwRedeem 所依赖 Admin API 的兼容性

源码对比结论：当前实际调用的核心路由在 `v0.1.184` 中都仍存在，方法、关键请求字段和统一响应信封未发生破坏性变化。升级风险主要来自**新增字段和业务语义修复**，而不是路由删除。

| 依赖 | `v0.1.184` 结论 | 建议 |
| --- | --- | --- |
| `PUT /api/v1/admin/payment/config` | 路由和 `balance_recharge_multiplier` 保留。`v0.1.170` 起仅写入请求中显式提供的字段，修复 `v0.1.137` 局部更新会把未提供配置写成空值的问题 | 升级后可以安全发送 `{ "balance_recharge_multiplier": 1.2 }` 这类局部更新，但仍建议先 GET、写入、再 GET 验证；倍率仍是全站余额充值倍率，不是用户级奖励 |
| `GET /api/v1/admin/payment/orders` | `user_id`、`status`、`order_type`、`payment_type`、`keyword` 过滤保留；`id`、`user_id`、`amount`、`pay_amount`、`currency`、`status`、`paid_at`、`completed_at`、`created_at` 等核心字段保留 | 当前首充识别逻辑兼容；保留对可空时间字段和附加字段的宽容解析 |
| `POST /api/v1/admin/users/:id/balance` | 请求仍为 `balance > 0`、`operation ∈ {set, add, subtract}`、`notes`；`Idempotency-Key` 机制保留 | 当前奖励发放契约兼容，继续使用稳定奖励 ID 作为幂等键 |
| `GET /api/v1/admin/usage` | 分页、`sort_by`、`sort_order`、`exact_total`、`start_date`、`end_date`、`timezone` 保留；`id`、`user_id`、`group_id`、`actual_cost`、`rate_multiplier`、`created_at` 保留，并新增多项字段/筛选 | Boss/摇摇乐同步兼容；集成测试应锁定分页信封、`actual_cost` 精度、Asia/Shanghai 边界和同时间戳排序 |
| `GET /api/v1/admin/subscriptions`、`POST /subscriptions/assign`、`POST /subscriptions/:id/extend` | 列表过滤、`assign` 的 `user_id/group_id/validity_days/notes`、`extend` 的 `days` 均保留；延期幂等机制保留。新增显式 revoke/restore 路由 | 当前“有有效订阅则延期、否则分配”的奖励逻辑兼容；重点回归并发延期不会丢天数 |
| `GET/PUT /api/v1/admin/users/:id` 的 `group_rates` | 响应仍为 `map[groupID]rate`；更新仍为 `map[groupID]*rate`，`null` 删除该组专属倍率 | 当前限时倍率权益兼容，但 `PUT user` 不使用 Admin 幂等包装，需继续依靠 kwRedeem 权益账本防重；请求只发送目标 `group_rates`，不要附带 `notes`，因为该字段会覆盖用户的管理员备注 |

关键源码：[支付路由](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/server/routes/payment.go)、[支付配置服务](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/service/payment_config_service.go)、[Admin 路由](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/server/routes/admin.go)、[用户 Handler](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/user_handler.go)、[用量 Handler](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/usage_handler.go)、[订阅 Handler](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/subscription_handler.go)、[DTO](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/dto/types.go)。

### 关于充值倍率奖励

本次升级会直接消除 `v0.1.137` 的 payment config 局部更新陷阱：官方提交 [`3deb2f17d8aa`](https://github.com/Wei-Shaw/sub2api/commit/3deb2f17d8aa5b94830838c3a3bf4d41d142d129) 把 `UpdatePaymentConfig` 改为只写入调用方显式提供的字段，随后收录在 `v0.1.170`。

但官方 `balance_recharge_multiplier` 仍然是**全站配置**。未发现按用户设置充值比例的字段或 Admin API；因此 Boss 的“个人限时充值返赠”仍应由 kwRedeem 记录用户权益，再按合格订单补发差额，而不是临时改全站倍率。

## 推荐升级步骤

以下步骤适用于同步自维护 fork，或升级任何仍运行 `v0.1.137` 的其他环境；当前 `sub.vsakura.top` 已是 `v0.1.184`，不需要重复执行生产升级。

1. 固定目标为 `weishaw/sub2api:0.1.184`，记录镜像 digest；不要使用 `latest`。
2. 备份并验证可恢复：PostgreSQL、Redis、`.env`、`config.yaml`、应用数据卷和当前 Compose。
3. 从生产 PostgreSQL 建立隔离副本，在副本上启动一次 `v0.1.184`，记录 85 个新增迁移的总耗时和 migration 226 的索引耗时。
4. 合并新版 Compose，而非整文件覆盖：保留当前密钥、网络、卷和私有上游设置；同步 `no-new-privileges`、Redis 命令、迁移超时等必要变化。
5. 上线前明确决定：长上下文计费开关、Grok 跨厂商映射、Codex 指纹收敛，以及生产 URL allowlist 策略。
6. 在测试环境跑 kwRedeem 集成冒烟：Admin 鉴权、用户查询、余额幂等加减、payment config 局部更新、订单筛选、用量分页与月界、订阅分配/并发延期、`group_rates` 设置与恢复。
7. 在维护窗口升级生产；只启动一个新版本实例完成迁移，确认完成后再恢复多实例，持续观察迁移、计费、支付回调和用量同步日志。
8. 回退时同时恢复升级前 PostgreSQL 备份；不能仅把应用镜像改回 `0.1.137`。

## 上线验收清单

- `/health` 正常，后台显示版本 `0.1.184`。
- `schema_migrations` 无失败或 checksum mismatch，新增迁移全部完成。
- `usage_logs` 两个 migration 226 索引存在且有效。
- kwRedeem 使用的 Admin key 鉴权正常。
- 余额奖励以相同 `Idempotency-Key` 重放不会重复入账。
- 单字段更新 `balance_recharge_multiplier` 不会清空其他支付设置。
- 支付订单筛选能找到指定用户已完成的 balance 订单。
- Boss 用量同步在 Asia/Shanghai 月界、相同 `created_at` 和多页数据下不重不漏。
- 订阅连续延期两次不会丢失其中一次天数。
- 设置/撤销 `group_rates` 后，其他用户字段和其他分组倍率保持不变。
- 长上下文账单、Grok 映射和 Codex 指纹行为符合升级前选定策略。

## 官方来源索引

- [v0.1.137 Release](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.137)
- [v0.1.184 Release](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.1.184)
- [官方版本比较](https://github.com/Wei-Shaw/sub2api/compare/4a5665da5...v0.1.184)
- [GHSA-vrxq-qm4h-6hgg](https://github.com/Wei-Shaw/sub2api/security/advisories/GHSA-vrxq-qm4h-6hgg)
- [数据库迁移说明](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/migrations/README.md)
- [数据库迁移器](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/repository/migrations_runner.go)
- [Docker 部署说明](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/deploy/README.md)
- [v0.1.184 Docker Compose](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/deploy/docker-compose.yml)
