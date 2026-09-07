# Sub2api 充值倍率 API 核查

核查日期：2026-08-31。

核查基线分为两套，避免把本地参考代码误认为线上版本：

- 本地 `sub2api/` 参考仓库为 `4a5665da5`（`v0.1.137`），且
  `README_JA.md` 存在未提交修改。
- `https://sub.vsakura.top/api/v1/settings/public` 返回 `version: 0.1.184`；线上实际运行
  `v0.1.184`，也是核查当日的官方最新稳定版。

## 结论

Sub2api 提供全站余额充值倍率配置，但没有用户级充值倍率字段或接口。

- 管理端接口为 `GET/PUT /api/v1/admin/payment/config`，受管理员认证与合规中间件保护
  （[官方 v0.1.184 路由源码](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/server/routes/payment.go)）。
- 更新请求接受 `balance_recharge_multiplier`；倍率必须为有限且大于 0 的数值，保存时格式化为
  两位小数（[官方 v0.1.184 配置服务](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/service/payment_config_service.go)）。
- `v0.1.184` 已采用真正的局部更新：只持久化请求中非 `nil` 的字段。官方也有遗漏字段保持不变、
  显式空值与 `false` 正常持久化的测试
  （[官方 v0.1.184 测试](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/service/payment_config_service_test.go)）。
  因此，之前基于本地 `v0.1.137` 得出的“最小 PUT 会清空其他支付配置”风险不适用于当前生产
  `v0.1.184`。
- 创建余额充值订单时，服务读取当时的全局配置并按
  `充值金额 × balance_recharge_multiplier` 计算到账额度；计算结果写入订单，因此已经创建的订单
  不会随之后的全局倍率修改重新计算
  （[订单创建源码](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/service/payment_order.go)、
  [金额计算源码](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/service/payment_amounts.go)）。
- 用户实体只有余额、累计充值、并发和 RPM 等字段，没有个人充值倍率。现有 `group_rates` 是 API
  使用计费倍率，不是充值到账倍率
  （[用户实体源码](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/ent/schema/user.go)、
  [管理端用户 DTO](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/user_handler.go)）。
- 远端对该路径的未认证 GET 和 PUT 均返回 `401`，说明当前部署已挂载受保护路由；核查未携带凭据，
  也没有修改远端配置。

当前生产 `v0.1.184` 可以安全发送最小更新请求：

```http
PUT /api/v1/admin/payment/config
x-api-key: <admin-api-key>
Content-Type: application/json

{"balance_recharge_multiplier":1.2}
```

这表示充值 100 时到账 120。调用只能由本项目后端使用保存的 Sub2api Admin API Key 发起，不能把
管理密钥或该能力暴露给前端。该配置影响全站所有用户，而非单个获奖者；Sub2api 本身也没有为它
提供有效期、自动恢复、个人上限或奖励预算控制。

若还有独立环境运行本地参考代码对应的 `v0.1.137`，不要在该旧环境发送只带倍率的最小 PUT；旧版
实现可能把未提供的支付字段一并写为空值。更重要的是，该版本还处于已知高危安全漏洞影响范围，
应优先升级，而不是围绕旧接口增加兼容逻辑。

## Boss 奖励建议

若奖励目标是 MVP 个人权益，不应直接修改全局倍率。建议在 KaWang 增加
`recharge_bonus`（限时充值返赠）权益：本地记录获奖用户、返赠率、有效期和返赠上限，轮询官方
已完成的余额充值订单，再通过现有的管理员余额调整接口补发差额。远端提供按用户、状态和订单类型
查询支付订单的接口，也提供带幂等键的用户余额调整接口
（[支付订单接口](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/payment_handler.go)、
[余额调整接口](https://github.com/Wei-Shaw/sub2api/blob/v0.1.184/backend/internal/handler/admin/user_handler.go)）。

建议配置字段：`bonusRate`、`durationDays`、`maxBonusAmount`、`fulfillmentMode`。同一充值订单
以 `奖励 ID + 远端订单 ID` 做幂等键；资格按订单完成时间判断；多个权益默认取最高返赠率、
不叠加。该类型仅用于 MVP 奖励，以保持现有共享奖励的小额、可控原则。

Boss PVE 已实现 `global_recharge_multiplier` 类型：每只 Boss 击败后由 KaWang 局部更新全站
`balance_recharge_multiplier`，后击败 Boss 的配置覆盖前一只，并在活动对应的北京时间自然月结束后
统一恢复为 `1x`。恢复失败会进入可重试状态。该奖励面向全站（包括未参战用户），成本仍无法由
Sub2api 原生封顶，因此发布前必须填写预算成本估算并通过活动月度预算校验。
