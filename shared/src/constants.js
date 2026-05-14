export const cdkeyStatuses = {
  active: "active",
  locked: "locked",
  used: "used",
  disabled: "disabled",
  void: "void"
};

export const orderStatuses = {
  pending: "pending",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed"
};

export const jobStatuses = {
  pending: "pending",
  processing: "processing",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled"
};

export const endpointTypes = {
  api: "api",
  webhook: "webhook",
  browser: "browser"
};

export const logActions = {
  login: "admin.login",
  siteUpsert: "site.upsert",
  siteToggleStatus: "site.toggle_status",
  siteHealthCheck: "site.health_check",
  batchImport: "cdkey.batch_import",
  cdkeySingleCreate: "cdkey.single_create",
  cdkeyBulk: "cdkey.bulk_action",
  endpointUpsert: "endpoint.upsert",
  productUpsert: "product.upsert",
  orderCreate: "order.create",
  jobRetry: "job.retry",
  jobSuccess: "job.success",
  jobFail: "job.fail",
  notificationMonitorUpsert: "notification.monitor.upsert",
  notificationMonitorDelete: "notification.monitor.delete",
  notificationMonitorToggle: "notification.monitor.toggle",
  notificationMonitorTest: "notification.monitor.test",
  notificationSettingsUpdate: "notification.settings.update",
  notificationFeishuSend: "notification.feishu.send"
};

export const notificationRuleOperators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists"
];

export const notificationMatchModes = ["all", "any"];

export const notificationEventTypes = {
  matched: "matched",
  notMatched: "not_matched",
  fetchError: "fetch_error",
  sendError: "send_error",
  sendOk: "send_ok",
  test: "test"
};
