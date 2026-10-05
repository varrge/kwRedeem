const retiredMessage = "旧版 Go / Python 会员付款已退役，请使用会员自动化中的协议站点配置";

export function isRetiredMembershipOperation(method, url) {
  if (url.startsWith("/api/extension/membership-")) return true;
  if (url === "/api/public/orders/:orderNo/membership-session") return true;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  if (url === "/api/admin/membership-card-platforms/:key") return false;
  // Historical compensation and acknowledgement only append audit evidence.
  if (url === "/api/admin/membership-fulfillments/:id/compensations"
      || url === "/api/admin/fulfillment-interventions/:id/ack") return false;
  return /^\/api\/admin\/(membership-|live-canary-authorizations|tier-rollout-qualifications|automatic-checkout-scopes|checkout-price-contracts|card-product-policies|fulfillment-circuits|checkout-validation-runs)/.test(url);
}

export function registerLegacyMembershipRetirement(app, db) {
  db.prepare(`UPDATE membership_fulfillment_settings SET enabled=0, rollout_mode='disabled'
    WHERE id='default' AND (enabled<>0 OR rollout_mode<>'disabled')`).run();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.some((method) => isRetiredMembershipOperation(method, route.url))) return;
    const existing = route.preHandler ? [route.preHandler].flat() : [];
    route.preHandler = [...existing, async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.code(410).send({ code: "LEGACY_MEMBERSHIP_RETIRED", message: retiredMessage });
    }];
  });
}
