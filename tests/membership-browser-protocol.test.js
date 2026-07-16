import test from "node:test";
import assert from "node:assert/strict";
import {
  MembershipBrowserProtocolError,
  membershipPageFingerprint,
  validateMembershipPaymentPage,
  validateMembershipStageControl
} from "../shared/src/membership-browser-protocol.js";

function paymentPage(overrides = {}) {
  const page = {
    stateId: "PAYMENT_FINAL_READY",
    origin: "https://pay.openai.com",
    routeTemplate: "/checkout/{id}",
    plan: "plus",
    country: "PH",
    currency: "PHP",
    displayedAmount: 1049,
    stateMarker: "review",
    fields: {
      cardNumber: true, expiry: true, expiryMonth: false, expiryYear: false, cvc: true,
      billingName: true, billingLine1: false, billingCity: false, billingState: false,
      billingCountry: true, billingPostal: true
    },
    controls: {
      progression: null,
      submit: "payment-submit",
      upgradeX5: null,
      upgradeX20: null,
      challenge: null
    },
    structuralHash: ""
  };
  Object.assign(page, overrides);
  page.structuralHash = membershipPageFingerprint(page);
  return page;
}

const binding = {
  stage: "plus",
  targetTier: "plus",
  adapterVersion: "checkout-v1",
  priceContract: { currency: "PHP", minAmount: 999, maxAmount: 1099 }
};

test("strict sanitized payment facts verify their own structural fingerprint and static control", () => {
  const page = paymentPage();
  assert.equal(validateMembershipPaymentPage(page, binding).structuralHash, page.structuralHash);
  assert.equal(validateMembershipStageControl(page, "submit", "payment-submit"), true);
});

test("raw or extra page facts and a changed fingerprint fail closed", () => {
  const extra = { ...paymentPage(), rawText: "Pay now" };
  assert.throws(() => validateMembershipPaymentPage(extra, binding), MembershipBrowserProtocolError);
  const changed = paymentPage();
  changed.displayedAmount = 1;
  assert.throws(() => validateMembershipPaymentPage(changed, binding), (error) => (
    error instanceof MembershipBrowserProtocolError && error.code === "MEMBERSHIP_PAGE_FINGERPRINT_MISMATCH"
  ));
});

test("plan management accepts only the static target-tier upgrade control", () => {
  const page = paymentPage({
    stateId: "UPGRADE_SELECTION_READY",
    origin: "https://chatgpt.com",
    routeTemplate: "/settings/subscription",
    plan: "prolite",
    displayedAmount: 2499,
    stateMarker: "upgrade-selection",
    fields: Object.fromEntries(Object.keys(paymentPage().fields).map((key) => [key, false])),
    controls: {
      progression: null,
      submit: null,
      upgradeX5: "upgrade-x5",
      upgradeX20: null,
      challenge: null
    }
  });
  assert.doesNotThrow(() => validateMembershipPaymentPage(page, {
    stage: "upgrade",
    targetTier: "x5",
    adapterVersion: "plan-management-v1",
    priceContract: { currency: "PHP", minAmount: 2400, maxAmount: 2600 }
  }));
});
