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
  batchImport: "cdkey.batch_import",
  cdkeySingleCreate: "cdkey.single_create",
  cdkeyBulk: "cdkey.bulk_action",
  endpointUpsert: "endpoint.upsert",
  productUpsert: "product.upsert",
  orderCreate: "order.create",
  jobRetry: "job.retry",
  jobSuccess: "job.success",
  jobFail: "job.fail"
};
