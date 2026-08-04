# kwMembership Go 配置资源

## Knowledge

- [SpaceX Card OpenAPI 文档](./spacexcard-openapi%20(1).md)
  上游余额、鉴权和状态字段的第一手接口契约。SpaceX CDK Canary 应优先按真实响应与本项目的保守约束核对。
- [KaWang SpaceX CDK 架构决策](./docs/adr/0009-wrap-spacex-cdks-for-store-fulfillment.md)
  记录包装码、库存优先、发码不确定、资金负债、玩家激活及退款竞态的项目约束。
- [kwMembership README](../kwMembership/README.md)
  本项目的真实目录、配置项、自检和自动处理流程。项目配置发生变化时优先以此文件和源码为准。
- [Go：编译和安装应用](https://go.dev/doc/tutorial/compile-install)
  Go 官方对 `go build` 与生成可执行文件的说明。用于理解 Worker 为什么以单个二进制运行。
- [Chrome Headless mode](https://developer.chrome.com/docs/chromium/headless)
  Chrome 官方对无界面运行方式的说明。用于理解“不打开可见浏览器”并不等于“不使用浏览器引擎”。
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html)
  SQLite 官方 WAL 文档。用于理解 kwRedeem 与 Go Worker 共享数据库时为什么必须保留数据库目录的写权限，并且不能随意分离 `.db`、`-wal` 和 `-shm`。
- [journalctl](https://www.freedesktop.org/software/systemd/man/255/journalctl.html)
  systemd 官方日志查询手册。用于查看 Worker 服务日志和按时间筛选故障。

## Wisdom (Operational feedback)

- kwRedeem 后台“ChatGPT 会员自动化 → 实施状态”和“会员履约记录”
  这是生产环境的最终反馈来源；优先看脱敏状态、心跳、Tick 和错误码，不靠猜测判断订单是否完成。
- 项目的审计日志和数据库备份
  付款 Gate、凭据和人工补建等变更应以审计记录及可恢复备份为依据。

## Gaps

- 真实付款 Canary 必须结合当时的页面快照、价格合同、卡片预算和订单状态逐单判断，不能固化成一条无条件执行命令。
