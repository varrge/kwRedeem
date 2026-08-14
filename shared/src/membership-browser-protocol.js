import { createHash } from "node:crypto";

export const membershipPaymentAdapters = Object.freeze({
  checkout: "checkout-v1",
  planManagement: "plan-management-v1"
});

const FIELD_KEYS = Object.freeze([
  "cardNumber", "expiry", "expiryMonth", "expiryYear", "cvc",
  "billingName", "billingLine1", "billingCity", "billingState",
  "billingCountry", "billingPostal"
]);
const CONTROL_KEYS = Object.freeze(["progression", "submit", "upgradeX5", "upgradeX20", "challenge"]);
const CONTROL_VALUES = Object.freeze({
  progression: new Set([null, "payment-next", "hosted-payment-next"]),
  submit: new Set([null, "payment-submit", "hosted-payment-submit"]),
  upgradeX5: new Set([null, "upgrade-x5"]),
  upgradeX20: new Set([null, "upgrade-x20"]),
  challenge: new Set([null, "challenge-3ds", "challenge-captcha", "challenge-sms", "challenge-bank"])
});
const STATE_IDS = new Set([
  "PAYMENT_CARD_ENTRY_READY",
  "PAYMENT_PROGRESSION_READY",
  "PAYMENT_FINAL_READY",
  "PAYMENT_ACTION_REQUIRED",
  "UPGRADE_SELECTION_READY",
  "UNKNOWN_PAYMENT_STATE"
]);
const STATE_MARKERS = new Set([null, "card-entry", "billing-entry", "review", "upgrade-selection", "challenge", "complete"]);
const ROUTES = new Set([
  "/checkout", "/checkout/{id}", "/pay/{id}",
  "/settings/subscription", "/settings/billing", "/account/billing/overview"
]);

export class MembershipBrowserProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MembershipBrowserProtocolError";
    this.code = code;
    this.statusCode = 400;
  }
}

function fail(code, message) {
  throw new MembershipBrowserProtocolError(code, message);
}

function strictKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function expectedPlan(stage, targetTier) {
  if (stage === "plus") return "plus";
  return targetTier === "x5" ? "prolite" : (targetTier === "x20" ? "pro" : null);
}

function canonicalShape(page) {
  return {
    stateId: page.stateId,
    origin: page.origin,
    routeTemplate: page.routeTemplate,
    plan: page.plan,
    country: page.country,
    currency: page.currency,
    displayedAmount: page.displayedAmount,
    stateMarker: page.stateMarker,
    fields: page.fields,
    controls: page.controls
  };
}

export function membershipPageFingerprint(page) {
  return createHash("sha256").update(JSON.stringify(canonicalShape(page))).digest("hex");
}

export function validateSanitizedMembershipPageShape(page) {
  if (!strictKeys(page, [
    "stateId", "origin", "routeTemplate", "plan", "country", "currency",
    "displayedAmount", "stateMarker", "fields", "controls", "structuralHash"
  ])) fail("MEMBERSHIP_PAGE_FACTS_INVALID", "页面事实字段无效");
  if (!STATE_IDS.has(page.stateId)
    || !["https://chatgpt.com", "https://pay.openai.com"].includes(page.origin)
    || !ROUTES.has(page.routeTemplate)
    || !["plus", "prolite", "pro"].includes(page.plan)
    || page.country !== "PH" || page.currency !== "PHP"
    || !Number.isFinite(page.displayedAmount) || page.displayedAmount <= 0 || page.displayedAmount > 10_000_000
    || !STATE_MARKERS.has(page.stateMarker)
    || !/^[a-f0-9]{64}$/.test(String(page.structuralHash || ""))) {
    fail("MEMBERSHIP_PAGE_FACTS_INVALID", "页面事实值无效");
  }
  if (!strictKeys(page.fields, FIELD_KEYS)
    || FIELD_KEYS.some((key) => typeof page.fields[key] !== "boolean")
    || !strictKeys(page.controls, CONTROL_KEYS)
    || CONTROL_KEYS.some((key) => !CONTROL_VALUES[key].has(page.controls[key]))) {
    fail("MEMBERSHIP_PAGE_FACTS_INVALID", "页面字段或控件事实无效");
  }
  if (membershipPageFingerprint(page) !== page.structuralHash) {
    fail("MEMBERSHIP_PAGE_FINGERPRINT_MISMATCH", "页面结构指纹不匹配");
  }
  return Object.freeze(JSON.parse(JSON.stringify(page)));
}

export function validateMembershipPaymentPage(page, binding = {}) {
  const normalizedPage = validateSanitizedMembershipPageShape(page);

  const stage = binding.stage === "upgrade" ? "upgrade" : (binding.stage === "plus" ? "plus" : null);
  const targetTier = ["plus", "x5", "x20"].includes(binding.targetTier) ? binding.targetTier : null;
  const adapterVersion = String(binding.adapterVersion || "");
  const contract = binding.priceContract;
  if (!stage || !targetTier || (stage === "upgrade" && targetTier === "plus")
    || !contract || contract.currency !== "PHP"
    || !Number.isFinite(contract.minAmount) || !Number.isFinite(contract.maxAmount)) {
    fail("MEMBERSHIP_PAGE_BINDING_INVALID", "页面绑定无效");
  }
  if (page.plan !== expectedPlan(stage, targetTier)
    || page.displayedAmount < contract.minAmount || page.displayedAmount > contract.maxAmount) {
    fail("CHECKOUT_PRICE_UNRECOGNIZED", "页面套餐或 PHP 金额不匹配");
  }
  const planRoutes = new Set(["/settings/subscription", "/settings/billing", "/account/billing/overview"]);
  if (adapterVersion === membershipPaymentAdapters.planManagement) {
    const expectedControl = targetTier === "x5" ? "upgrade-x5" : "upgrade-x20";
    const actualControl = targetTier === "x5" ? page.controls.upgradeX5 : page.controls.upgradeX20;
    if (stage !== "upgrade" || page.origin !== "https://chatgpt.com"
      || !planRoutes.has(page.routeTemplate) || page.stateId !== "UPGRADE_SELECTION_READY"
      || actualControl !== expectedControl || page.controls.progression || page.controls.submit) {
      fail("CHECKOUT_UI_UNSUPPORTED", "升级选择页面无法识别");
    }
  } else if (adapterVersion === membershipPaymentAdapters.checkout) {
    const allowedCheckoutRoute = page.origin === "https://chatgpt.com"
      ? new Set(["/checkout", "/checkout/{id}"]).has(page.routeTemplate)
      : new Set(["/checkout/{id}", "/pay/{id}"]).has(page.routeTemplate);
    if (!allowedCheckoutRoute || planRoutes.has(page.routeTemplate)) {
      fail("CHECKOUT_UI_UNSUPPORTED", "支付页面路由无法识别");
    }
    if (page.stateId === "PAYMENT_CARD_ENTRY_READY") {
      const card = page.fields.cardNumber && page.fields.cvc
        && (page.fields.expiry || (page.fields.expiryMonth && page.fields.expiryYear));
      const billing = page.fields.billingName || page.fields.billingCountry || page.fields.billingPostal;
      const address = page.fields.billingLine1 || page.fields.billingCity || page.fields.billingState;
      if (!card || billing || address || !page.controls.submit || page.controls.progression) {
        fail("CHECKOUT_UI_UNSUPPORTED", "卡片输入页面结构无效");
      }
    }
    if (page.stateId === "PAYMENT_PROGRESSION_READY" && !page.controls.progression) {
      fail("CHECKOUT_UI_UNSUPPORTED", "支付下一步控件缺失");
    }
    if (page.stateId === "PAYMENT_FINAL_READY" && !page.controls.submit) {
      fail("CHECKOUT_UI_UNSUPPORTED", "支付提交控件缺失");
    }
    if (page.stateId === "PAYMENT_ACTION_REQUIRED" && !page.controls.challenge) {
      fail("CHECKOUT_UI_UNSUPPORTED", "人工验证控件缺失");
    }
  } else {
    fail("CHECKOUT_UI_UNSUPPORTED", "页面适配器版本不受支持");
  }
  return normalizedPage;
}

export function validateMembershipStageControl(page, permitKind, controlId) {
  if (permitKind === "progression") {
    if (!["PAYMENT_PROGRESSION_READY", "UPGRADE_SELECTION_READY"].includes(page.stateId)) {
      fail("PAYMENT_CONTROL_UNRECOGNIZED", "当前页面不允许下一步操作");
    }
    const controls = [page.controls.progression, page.controls.upgradeX5, page.controls.upgradeX20];
    if (!controls.includes(controlId)) fail("PAYMENT_CONTROL_UNRECOGNIZED", "下一步控件不匹配");
  } else if (permitKind === "submit") {
    if (page.stateId !== "PAYMENT_FINAL_READY") {
      fail("PAYMENT_CONTROL_UNRECOGNIZED", "当前页面不允许提交支付");
    }
    if (page.controls.submit !== controlId) fail("PAYMENT_CONTROL_UNRECOGNIZED", "提交控件不匹配");
  } else {
    fail("PAYMENT_CONTROL_UNRECOGNIZED", "许可类型无效");
  }
  return true;
}
