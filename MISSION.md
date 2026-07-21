# Mission: 独立配置和运维 kwMembership Go 自动化

## Why
能够不依赖浏览器扩展或人工打开浏览器，在现有 kwRedeem 后台中完成 Go Worker 的配置、检查和日常运维，并安全地查看订单处理状态。

## Success looks like
- 能确认 Go Worker 指向 kwRedeem 的同一个 SQLite/WAL 数据库
- 能在后台安全保存 SpaceX Card 和 GPT 凭据并初始化库存
- 能从后台和 systemd 判断 Worker 是否健康
- 能区分基础配置与 `no_charge`、`canary`、`automatic` 付款发布阶段

## Constraints
- 使用中文和可直接执行的步骤
- 以现有 Ubuntu 服务器和当前部署路径为准
- 默认保持付款 Gate 关闭
- 不在终端、日志或截图中暴露 Session、卡资料和 Token

## Out of scope
- 修改 `sub2api/` 参考项目
- 绕过 CAPTCHA、3DS、短信或银行验证
- 未经受控试单直接开启自动付款
