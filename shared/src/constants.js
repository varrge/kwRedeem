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

export const notificationMonitorTypes = ["http", "browser"];

export const notificationEventTypes = {
  matched: "matched",
  notMatched: "not_matched",
  fetchError: "fetch_error",
  sendError: "send_error",
  sendOk: "send_ok",
  test: "test"
};

// ─── 提号系统常量 ───────────────────────────────────────────

export const quotaCardStatuses = {
  active: "active",
  used: "used",
  failed: "failed"
};

export const quotaSubCardStatuses = {
  active: "active",
  used: "used",
  locked: "locked",
  void: "void"
};

export const quotaBatchStatuses = {
  pending: "pending",
  completed: "completed",
  partial: "partial"
};

export const quotaErrorCodes = {
  CARD_EXISTS: "CARD_EXISTS",
  CARD_INVALID: "CARD_INVALID",
  CARD_EXHAUSTED: "CARD_EXHAUSTED",
  QUOTA_INSUFFICIENT: "QUOTA_INSUFFICIENT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  CARD_LOCKED: "CARD_LOCKED",
  EXTERNAL_API_ERROR: "EXTERNAL_API_ERROR",
  CANCEL_DENIED: "CANCEL_DENIED"
};

// 频率限制默认值
export const QUOTA_RATE_LIMIT_WINDOW = 60;
export const QUOTA_RATE_LIMIT_MAX = 10;
export const QUOTA_LOCK_DURATION_MINUTES = 30;
