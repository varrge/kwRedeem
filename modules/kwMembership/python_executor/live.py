"""Fail-closed Playwright adapter for the Go-owned checkout protocol.

This module deliberately has no retry or business-state transitions.  It only
turns a leased command into browser observations and permit-bound clicks.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from .client import ExecutorAPIError, ExecutorClient, ExecutorLease


CHATGPT_ORIGIN = "https://chatgpt.com"
PAY_ORIGIN = "https://pay.openai.com"
SESSION_COOKIE = "__Secure-next-auth.session-token"
SESSION_CHUNK_SIZE = 3936
MAX_TRANSITIONS = 6
POLL_SECONDS = 0.25
HEARTBEAT_SECONDS = 5.0
REPORT_MARGIN_SECONDS = 15.0
AUTH_REDIRECT_GRACE_SECONDS = 5.0
PROFILE_MAX_AGE_SECONDS = 2 * 60 * 60
PROFILE_BINDING_FILE = ".kwmembership-profile.json"
SAFE_FULFILLMENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
LOGGER = logging.getLogger("kwmembership.python_executor.live")
FACT_FIELD_KEYS = (
    "cardNumber", "expiry", "expiryMonth", "expiryYear", "cvc",
    "billingName", "billingLine1", "billingCity", "billingState", "billingCountry", "billingPostal",
)
FACT_CONTROL_KEYS = ("progression", "submit", "upgradeX5", "upgradeX20", "challenge")

INSPECT_FRAME_JS = r"""
() => {
  const allowed = new Set(['https://chatgpt.com', 'https://pay.openai.com', 'https://js.stripe.com']);
  const origin = allowed.has(location.origin) ? location.origin : null;
  const path = String(location.pathname || '');
  let route = null;
  const safeID = value => /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const match = (prefix) => {
    const trimmed = path.replace(/\/$/, '');
    const value = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : '';
    return safeID(value) ? '/{id}' : null;
  };
  if (origin === 'https://chatgpt.com') {
    if (path === '/checkout' || path === '/checkout/') route = '/checkout';
    else if (/^\/checkout\/openai_llc\/(?:oaics_|cs_)[A-Za-z0-9_-]+\/?$/.test(path) || /^\/checkout\/[A-Za-z0-9_-]+\/?$/.test(path)) route = '/checkout/{id}';
    else if (path === '/settings/subscription' || path === '/settings/subscription/') route = '/settings/subscription';
    else if (path === '/settings/billing' || path === '/settings/billing/') route = '/settings/billing';
    else if (path === '/account/billing/overview' || path === '/account/billing/overview/') route = '/account/billing/overview';
  } else if (origin === 'https://pay.openai.com') {
    if (/^\/checkout\/[A-Za-z0-9_-]+\/?$/.test(path)) route = '/checkout/{id}';
    else if (/^\/(?:c\/)?pay\/[A-Za-z0-9_-]+\/?$/.test(path)) route = '/pay/{id}';
  }
  const find = selectors => selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
  const attr = (selectors, names) => {
    const element = find(selectors); if (!element) return null;
    for (const name of names) { const value = element.getAttribute(name); if (value && value.trim()) return value.trim(); }
    return null;
  };
  const has = selectors => Boolean(find(selectors));
  const control = entries => { for (const [id, selectors] of entries) if (has(selectors)) return id; return null; };
  const pageText = String(document.body?.innerText || document.body?.textContent || '');
  const textPlan = /\b(?:ChatGPT\s+)?Plus\b/i.test(pageText) ? 'plus' : (/\bChatGPT\s+Pro\b/i.test(pageText) ? 'pro' : null);
  const textAmounts = [];
  for (const pattern of [/(?:PHP|\u20B1)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi, /([0-9][0-9,]*(?:\.\d{1,2})?)\s*PHP\b/gi]) {
    for (const match of pageText.matchAll(pattern)) {
      const value = Number(String(match[1] || '').replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0 && value <= 10000000) textAmounts.push(value);
    }
  }
  const planRaw = attr(['[data-kw-plan]', '[data-testid="plan-name"][data-plan]', 'meta[name="openai-plan"]'], ['data-kw-plan', 'data-plan', 'content']);
  const countryRaw = attr(['[data-kw-country]', '[data-testid="checkout-price"][data-country]', 'meta[name="openai-country"]'], ['data-kw-country', 'data-country', 'content']);
  const currencyRaw = attr(['[data-kw-currency]', '[data-testid="checkout-price"][data-currency]', 'meta[name="openai-currency"]'], ['data-kw-currency', 'data-currency', 'content']);
  const amountRaw = attr(['[data-kw-amount]', '[data-testid="checkout-price"][data-amount]', 'meta[name="openai-amount"]'], ['data-kw-amount', 'data-amount', 'content']);
  const stateRaw = attr(['[data-kw-checkout-state]', '[data-testid="checkout-state"][data-state]'], ['data-kw-checkout-state', 'data-state']);
  const attributeAmount = amountRaw !== null && /^\d+(?:\.\d{1,2})?$/.test(amountRaw) ? Number(amountRaw) : null;
  const displayedAmounts = Array.from(new Set([attributeAmount, ...textAmounts].filter(value => Number.isFinite(value) && value > 0)));
  const amount = displayedAmounts.length === 1 ? displayedAmounts[0] : null;
  return {
    origin, routeTemplate: route,
    plan: ['plus', 'prolite', 'pro'].includes(planRaw) ? planRaw : textPlan,
    country: countryRaw === 'PH' ? 'PH' : null,
    currency: currencyRaw === 'PHP' || textAmounts.length > 0 ? 'PHP' : null,
    displayedAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
    displayedAmounts,
    stateMarker: ['card-entry', 'billing-entry', 'review', 'upgrade-selection', 'challenge', 'complete'].includes(stateRaw) ? stateRaw : null,
    fields: {
      cardNumber: has(['#payment-numberInput', 'input[name="number"]', 'input[autocomplete="cc-number"]']),
      expiry: has(['#payment-expiryInput', 'input[name="expiry"]', 'input[autocomplete="cc-exp"]']),
      expiryMonth: has(['#payment-expiryMonthInput', 'select[name="exp-month"]']),
      expiryYear: has(['#payment-expiryYearInput', 'select[name="exp-year"]']),
      cvc: has(['#payment-cvcInput', 'input[name="cvc"]', 'input[autocomplete="cc-csc"]']),
      billingName: has(['#billingAddress-nameInput', 'input[name="name"]', 'input[autocomplete="billing name"]']),
      billingLine1: has(['#billingAddress-line1Input', 'input[name="addressLine1"]', 'input[autocomplete="billing address-line1"]']),
      billingCity: has(['#billingAddress-cityInput', 'input[name="city"]', 'input[autocomplete="billing address-level2"]']),
      billingState: has(['#billingAddress-stateInput', 'select[name="state"]', 'input[autocomplete="billing address-level1"]']),
      billingCountry: has(['#billingAddress-countryInput', 'select[name="country"]', 'select[autocomplete="billing country"]']),
      billingPostal: has(['#billingAddress-postalCodeInput', 'input[name="postalCode"]', 'input[autocomplete="billing postal-code"]'])
    },
    controls: {
      progression: control([['payment-next', ['#payment-next', '[data-testid="checkout-next"]']], ['hosted-payment-next', ['[data-testid="hosted-payment-next-button"]', 'button[name="continue-payment"]']]]),
      submit: control([['payment-submit', ['#payment-submit', '[data-testid="checkout-submit"]']], ['hosted-payment-submit', ['[data-testid="hosted-payment-submit-button"]', 'button[name="submit-payment"]', 'button[type="submit"]']]]),
      upgradeX5: control([['upgrade-x5', ['[data-testid="upgrade-to-prolite"]', 'button[data-plan="prolite"][data-action="upgrade"]']]]),
      upgradeX20: control([['upgrade-x20', ['[data-testid="upgrade-to-pro"]', 'button[data-plan="pro"][data-action="upgrade"]']]]),
      challenge: control([
        ['challenge-cloudflare', ['#challenge-form', '#challenge-running', 'input[name="cf-turnstile-response"]', 'iframe[src*="challenges.cloudflare.com"]']],
        ['challenge-3ds', ['[data-testid="three-d-secure-challenge"]', 'iframe[title="3D Secure authentication"]']],
        ['challenge-captcha', ['[data-testid="captcha-challenge"]']],
        ['challenge-sms', ['[data-testid="sms-verification"]']],
        ['challenge-bank', ['[data-testid="bank-verification"]']]
      ])
    }
  };
}
"""

FILL_FRAME_JS = r"""
(fragment) => {
  if (!['https://chatgpt.com', 'https://pay.openai.com', 'https://js.stripe.com'].includes(location.origin)) return {accepted:false,filled:[]};
  const selectors = {
    cardNumber: ['#payment-numberInput', 'input[name="number"]', 'input[autocomplete="cc-number"]'], expiry: ['#payment-expiryInput', 'input[name="expiry"]', 'input[autocomplete="cc-exp"]'],
    expiryMonth: ['#payment-expiryMonthInput', 'select[name="exp-month"]'], expiryYear: ['#payment-expiryYearInput', 'select[name="exp-year"]'], cvc: ['#payment-cvcInput', 'input[name="cvc"]', 'input[autocomplete="cc-csc"]'],
    billingName: ['#billingAddress-nameInput', 'input[name="name"]', 'input[autocomplete="billing name"]'], billingLine1: ['#billingAddress-line1Input', 'input[name="addressLine1"]', 'input[autocomplete="billing address-line1"]'],
    billingCity: ['#billingAddress-cityInput', 'input[name="city"]', 'input[autocomplete="billing address-level2"]'], billingState: ['#billingAddress-stateInput', 'select[name="state"]', 'input[autocomplete="billing address-level1"]'],
    billingCountry: ['#billingAddress-countryInput', 'select[name="country"]', 'select[autocomplete="billing country"]'], billingPostal: ['#billingAddress-postalCodeInput', 'input[name="postalCode"]', 'input[autocomplete="billing postal-code"]']
  };
  const find = key => (selectors[key] || []).map(selector => document.querySelector(selector)).find(Boolean) || null;
  const filled = [];
  for (const [key, value] of Object.entries(fragment || {})) {
    if (typeof value !== 'string') continue;
    const element = find(key); if (!element) continue;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value); else element.value = value;
    for (const type of ['input', 'change', 'blur']) element.dispatchEvent(new Event(type, {bubbles:true}));
    filled.push(key);
  }
  return {accepted:true,filled};
}
"""

CONTROL_SELECTORS = {
    "payment-next": ("#payment-next", '[data-testid="checkout-next"]'),
    "hosted-payment-next": ('[data-testid="hosted-payment-next-button"]', 'button[name="continue-payment"]'),
    "payment-submit": ("#payment-submit", '[data-testid="checkout-submit"]'),
    "hosted-payment-submit": ('[data-testid="hosted-payment-submit-button"]', 'button[name="submit-payment"]', 'button[type="submit"]'),
    "upgrade-x5": ('[data-testid="upgrade-to-prolite"]', 'button[data-plan="prolite"][data-action="upgrade"]'),
    "upgrade-x20": ('[data-testid="upgrade-to-pro"]', 'button[data-plan="pro"][data-action="upgrade"]'),
}

PREPARE_PLUS_JS = r"""
async () => {
  const result = (overrides = {}) => ({responseTag:'',checkoutURL:'',processorEntity:'',checkoutSessionID:'',checkoutSessionClass:'',customMaterialReady:false,contractViolation:'',errorKind:'',httpStatus:0,...overrides});
  if (location.origin !== 'https://chatgpt.com') return result({errorKind:'context_invalid'});
  try { delete window.__kwmembershipCustomCheckout; } catch {}
  const controller = new AbortController(); const abortTimer = setTimeout(() => controller.abort(), 12000);
  try {
    const sessionResponse = await fetch('/api/auth/session', {method:'GET', credentials:'include', cache:'no-store', redirect:'error', signal:controller.signal});
    if (!sessionResponse.ok) return result({errorKind:'session_unavailable',httpStatus:sessionResponse.status});
    const session = await sessionResponse.json(); const accessToken = typeof session?.accessToken === 'string' ? session.accessToken : '';
    if (!accessToken) return result({errorKind:'access_token_unavailable'});
    let claims = {};
    try { const encoded = accessToken.split('.')[1] || ''; claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))); } catch {}
    const authClaims = claims?.['https://api.openai.com/auth'];
    const candidates = [session?.account?.id, session?.account?.account_id, session?.accountId, session?.account_id, session?.user?.accountId, session?.user?.account_id, claims?.chatgpt_account_id, claims?.account_id, authClaims?.chatgpt_account_id, authClaims?.account_id];
    const accountID = candidates.find(value => typeof value === 'string' && value.length > 0) || '';
    const headers = {authorization:'Bearer '+accessToken};
    if (accountID) headers['ChatGPT-Account-ID'] = accountID;
    if (accountID) {
      const subscriptionResponse = await fetch('/backend-api/subscriptions?account_id='+encodeURIComponent(accountID), {method:'GET',credentials:'include',cache:'no-store',redirect:'error',headers,signal:controller.signal});
      if (subscriptionResponse.ok) {
        const subscription = await subscriptionResponse.json();
        const plan = typeof subscription?.plan_type === 'string' ? subscription.plan_type.toLowerCase() : '';
        const activeUntil = Date.parse(typeof subscription?.active_until === 'string' ? subscription.active_until : '');
        if (['plus','prolite','pro','team','business','enterprise'].includes(plan) && Number.isFinite(activeUntil) && activeUntil > Date.now() && subscription?.is_delinquent !== true) return result({errorKind:'already_subscribed'});
      }
    }
    const requestContext = Object.freeze({country:'PH',currency:'PHP',planName:'chatgptplusplan'});
    const response = await fetch('/backend-api/payments/checkout', {method:'POST', credentials:'include', cache:'no-store', redirect:'error', signal:controller.signal, headers:{...headers,'content-type':'application/json'}, body:JSON.stringify({billing_details:{country:requestContext.country,currency:requestContext.currency},checkout_ui_mode:'hosted',entry_point:'all_plans_pricing_modal',plan_name:requestContext.planName})});
    if (!response.ok) return result({errorKind:response.status===401||response.status===403?'checkout_unauthorized':'checkout_rejected',httpStatus:response.status});
    const payload = await response.json();
    const entry = {responseTag:typeof payload?.tag==='string'?payload.tag:'',checkoutURL:typeof payload?.url==='string'?payload.url:'',processorEntity:typeof payload?.processor_entity==='string'?payload.processor_entity:'',checkoutSessionID:typeof payload?.checkout_session_id==='string'?payload.checkout_session_id:''};
    if (entry.responseTag === 'custom_checkout_session') {
      const safeSessionID = /^(?:oaics_|cs_)[A-Za-z0-9_-]+$/.test(entry.checkoutSessionID);
      const checkoutSessionClass = entry.checkoutSessionID.startsWith('oaics_') ? 'oaics_' : (entry.checkoutSessionID.startsWith('cs_') ? 'cs_' : '');
      const customEntry = {...entry,checkoutSessionID:'',checkoutSessionClass};
      const publishableKey = typeof payload?.publishable_key === 'string' ? payload.publishable_key : '';
      const clientSecret = typeof payload?.client_secret === 'string' ? payload.client_secret : '';
      const validKey = /^pk_(?:live|test)_[A-Za-z0-9_]+$/.test(publishableKey) && publishableKey.length <= 512;
      const validSecret = /^cs_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(clientSecret) && clientSecret.length <= 4096;
      const contractViolation = !safeSessionID ? 'checkout_session_id'
        : (!validKey ? 'publishable_key'
          : (!validSecret ? 'client_secret'
            : (entry.processorEntity !== 'openai_llc' ? 'processor_entity' : '')));
      if (contractViolation) {
        return result({...customEntry,contractViolation,errorKind:'custom_checkout_material_invalid'});
      }
      Object.defineProperty(window, '__kwmembershipCustomCheckout', {
        value: Object.freeze({publishableKey,clientSecret,country:requestContext.country,currency:requestContext.currency,plan:'plus'}),
        configurable: true,
      });
      return result({...customEntry,customMaterialReady:true});
    }
    return result(entry);
  } catch { return result({errorKind:'checkout_unavailable'}); } finally { clearTimeout(abortTimer); }
}
"""

MOUNT_CUSTOM_CHECKOUT_JS = r"""
async () => {
  const result = (overrides = {}) => ({mounted:false,errorKind:'',...overrides});
  if (location.origin !== 'https://chatgpt.com') return result({errorKind:'context_invalid'});
  const material = window.__kwmembershipCustomCheckout;
  try { delete window.__kwmembershipCustomCheckout; } catch {}
  if (!material || typeof material.publishableKey !== 'string' || typeof material.clientSecret !== 'string'
      || material.country !== 'PH' || material.currency !== 'PHP' || material.plan !== 'plus') {
    return result({errorKind:'custom_checkout_material_missing'});
  }
  const stripeSource = 'https://js.stripe.com/dahlia/stripe.js';
  try {
    if (typeof window.Stripe !== 'function') {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = callback => { if (settled) return; settled = true; clearTimeout(timer); callback(); };
        const timer = setTimeout(() => finish(() => reject(new Error('stripe_timeout'))), 12000);
        const existing = document.querySelector(`script[src="${stripeSource}"]`);
        const script = existing || document.createElement('script');
        script.addEventListener('load', () => finish(resolve), {once:true});
        script.addEventListener('error', () => finish(() => reject(new Error('stripe_load_failed'))), {once:true});
        if (!existing) { script.src = stripeSource; script.async = true; document.head.appendChild(script); }
        else if (typeof window.Stripe === 'function') finish(resolve);
      });
    }
    if (typeof window.Stripe !== 'function') return result({errorKind:'stripe_unavailable'});
    const stripe = window.Stripe(material.publishableKey);
    const initializer = typeof stripe.initCheckoutElementsSdk === 'function'
      ? stripe.initCheckoutElementsSdk.bind(stripe)
      : (typeof stripe.initCheckout === 'function' ? stripe.initCheckout.bind(stripe) : null);
    if (!initializer) return result({errorKind:'stripe_checkout_unavailable'});
    const checkout = await initializer({clientSecret:material.clientSecret});
    const loadActionsResult = await checkout.loadActions();
    if (loadActionsResult?.type !== 'success' || !loadActionsResult.actions) {
      return result({errorKind:'checkout_session_unavailable'});
    }
    const actions = loadActionsResult.actions;
    const sessionFacts = current => {
      const currency = typeof current?.currency === 'string' ? current.currency.toUpperCase() : '';
      const minorAmount = Number(current?.total?.total?.minorUnitsAmount);
      const divisor = Number(current?.minorUnitsAmountDivisor);
      const amount = minorAmount / divisor;
      if (currency !== material.currency || !Number.isFinite(minorAmount) || minorAmount <= 0
          || !Number.isFinite(divisor) || divisor <= 0 || !Number.isFinite(amount) || amount <= 0) return null;
      return {currency,amount};
    };
    const initialFacts = sessionFacts(actions.getSession());
    if (!initialFacts) {
      return result({errorKind:'checkout_session_contract_invalid'});
    }

    const root = document.createElement('main');
    root.dataset.kwPlan = material.plan;
    root.dataset.kwCountry = material.country;
    root.dataset.kwCurrency = initialFacts.currency;
    root.dataset.kwAmount = String(Number(initialFacts.amount.toFixed(2)));
    root.dataset.kwCheckoutState = 'card-entry';
    root.style.cssText = 'max-width:560px;margin:32px auto;padding:24px;font-family:Arial,sans-serif;color:#111;background:#fff';
    const title = document.createElement('h1');
    title.textContent = 'ChatGPT Plus';
    title.style.cssText = 'font-size:20px;margin:0 0 8px';
    const totalLabel = document.createElement('p');
    totalLabel.textContent = `${initialFacts.currency} ${initialFacts.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    totalLabel.style.cssText = 'font-size:16px;margin:0 0 20px';
    const form = document.createElement('form');
    form.id = 'payment-form';
    form.addEventListener('submit', event => event.preventDefault());
    const payment = document.createElement('div');
    payment.id = 'payment-element';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'hosted-payment-submit-button';
    button.textContent = 'Pay';
    button.disabled = true;
    button.style.cssText = 'width:100%;margin-top:20px;padding:12px;border:0;border-radius:6px;background:#111;color:#fff;font-size:15px';
    const errors = document.createElement('div');
    errors.id = 'confirm-errors';
    errors.setAttribute('role', 'status');
    errors.style.cssText = 'margin-top:12px;color:#b42318;font-size:14px';
    form.append(payment, button, errors);
    root.append(title, totalLabel, form);
    document.body.replaceChildren(root);
    history.replaceState(history.state, '', '/checkout');

    const paymentElement = checkout.createPaymentElement();
    paymentElement.mount(payment);
    checkout.on('change', current => {
      const currentFacts = sessionFacts(current);
      if (!currentFacts) {
        delete root.dataset.kwAmount;
        button.disabled = true;
        return;
      }
      root.dataset.kwCurrency = currentFacts.currency;
      root.dataset.kwAmount = String(Number(currentFacts.amount.toFixed(2)));
      totalLabel.textContent = `${currentFacts.currency} ${currentFacts.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      button.disabled = !current.canConfirm;
    });
    button.addEventListener('click', () => {
      button.disabled = true;
      errors.textContent = '';
      actions.confirm().then(confirmResult => {
        if (confirmResult?.type === 'error') errors.textContent = String(confirmResult.error?.message || 'Payment could not be submitted.');
      });
    });
    return result({mounted:true});
  } catch {
    return result({errorKind:'custom_checkout_unavailable'});
  }
}
"""

SESSION_IDENTITY_JS = r"""
async () => {
  try {
    const response = await fetch('/api/auth/session', {
      credentials:'include', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) return {email:'',errorKind:'present'};
    const session = await response.json();
    return {email: session?.user?.email || session?.email || '', errorKind: session?.error || ''};
  } catch {
    return {email:'',errorKind:'present'};
  }
}
"""


def normalize_email(value: Any) -> str:
    value = str(value or "").strip().lower()
    if len(value) > 254 or value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
        return ""
    return value


def session_cookies(session: dict[str, Any], now: float | None = None) -> list[dict[str, Any]]:
    token = session.get("sessionToken")
    if not isinstance(token, str) or not token or token.strip() != token or len(token) > 65536:
        raise ExecutorAPIError("SESSION_COOKIE_MISSING", 409)
    expires = session.get("expires")
    expiry = None
    if expires:
        try:
            expiry = datetime.fromisoformat(str(expires).replace("Z", "+00:00")).timestamp()
        except ValueError as error:
            raise ExecutorAPIError("SESSION_INVALID", 409) from error
        if now is not None and expiry <= now:
            raise ExecutorAPIError("CHATGPT_SESSION_UNAUTHORIZED", 409)
    chunks = [token[index : index + SESSION_CHUNK_SIZE] for index in range(0, len(token), SESSION_CHUNK_SIZE)]
    return [
        {"name": SESSION_COOKIE if len(chunks) == 1 else f"{SESSION_COOKIE}.{index}", "value": value,
         "domain": ".chatgpt.com", "path": "/", "secure": True, "httpOnly": True, "sameSite": "Lax",
         **({"expires": expiry} if expiry is not None else {})}
        for index, value in enumerate(chunks)
    ]


def validate_checkout_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.username or parsed.fragment:
        raise ExecutorAPIError("CHECKOUT_URL_INVALID", 409)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    if origin == CHATGPT_ORIGIN and (path == "/checkout" or path == "/settings/subscription"):
        return value
    if origin == CHATGPT_ORIGIN and path.startswith("/checkout/"):
        route_id = path.removeprefix("/checkout/")
        if route_id.startswith("openai_llc/"):
            route_id = route_id.removeprefix("openai_llc/")
            if not (route_id.startswith("oaics_") or route_id.startswith("cs_")):
                route_id = ""
        if route_id and all(char.isalnum() or char in "_-" for char in route_id):
            return value
    if origin == PAY_ORIGIN and (path.startswith("/checkout/") or path.startswith("/pay/") or path.startswith("/c/pay/")):
        route_id = path.split("/")[-1]
        if route_id and all(char.isalnum() or char in "_-" for char in route_id):
            return value
    raise ExecutorAPIError("CHECKOUT_URL_INVALID", 409)


def route_template(value: str) -> str:
    parsed = urlsplit(value)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path.rstrip("/")
    if origin == CHATGPT_ORIGIN:
        if path == "/checkout": return "/checkout"
        if path.startswith("/checkout/") and path.removeprefix("/checkout/"):
            route_id = path.removeprefix("/checkout/")
            if route_id.startswith("openai_llc/"):
                route_id = route_id.removeprefix("openai_llc/")
                if not (route_id.startswith("oaics_") or route_id.startswith("cs_")):
                    return ""
            if all(char.isalnum() or char in "_-" for char in route_id): return "/checkout/{id}"
        if path in {"/settings/subscription", "/settings/billing", "/account/billing/overview"}: return path
    if origin == PAY_ORIGIN:
        if path.startswith("/checkout/"):
            route_id = path.removeprefix("/checkout/")
            if route_id and all(char.isalnum() or char in "_-" for char in route_id): return "/checkout/{id}"
        if path.startswith("/pay/") or path.startswith("/c/pay/"):
            route_id = path.split("/")[-1]
            if route_id and all(char.isalnum() or char in "_-" for char in route_id): return "/pay/{id}"
    return ""


def structural_hash(page: dict[str, Any]) -> str:
    value = dict(page)
    value["structuralHash"] = ""
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def _browser_proxy_from_env() -> dict[str, str] | None:
    server = os.environ.get("KWMEMBERSHIP_CHROME_PROXY_SERVER", "").strip()
    username = os.environ.get("KWMEMBERSHIP_CHROME_PROXY_USERNAME", "")
    password = os.environ.get("KWMEMBERSHIP_CHROME_PROXY_PASSWORD", "")
    if not server:
        if username or password:
            raise ExecutorAPIError("CHROME_PROXY_CONFIG_INVALID", 503)
        return None
    if bool(username) != bool(password):
        raise ExecutorAPIError("CHROME_PROXY_CONFIG_INVALID", 503)
    proxy = {"server": server}
    if username:
        proxy.update({"username": username, "password": password})
    return proxy


def _interactive_session_bootstrap_enabled() -> bool:
    return os.environ.get("KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP", "false") == "true"


def _proxy_fingerprint(proxy: dict[str, str] | None) -> str:
    raw = json.dumps(proxy or {}, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def _write_profile_binding(path: str, fulfillment_id: str, proxy_fingerprint: str, authenticated: bool) -> None:
    payload = json.dumps({
        "version": 1,
        "fulfillmentId": fulfillment_id,
        "proxyFingerprint": proxy_fingerprint,
        "authenticated": authenticated,
        "updatedAt": datetime.now().astimezone().isoformat(),
    }, sort_keys=True, separators=(",", ":")).encode()
    target = os.path.join(path, PROFILE_BINDING_FILE)
    temporary = target + ".tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _read_profile_binding(path: str) -> dict[str, Any] | None:
    try:
        with open(os.path.join(path, PROFILE_BINDING_FILE), "rb") as source:
            value = json.load(source)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _cleanup_stale_profiles(root: str, now: float | None = None) -> None:
    cutoff = (time.time() if now is None else now) - PROFILE_MAX_AGE_SECONDS
    try:
        entries = list(os.scandir(root))
    except OSError:
        return
    for entry in entries:
        if not SAFE_FULFILLMENT_ID.fullmatch(entry.name) or entry.is_symlink():
            continue
        try:
            if entry.is_dir(follow_symlinks=False) and entry.stat(follow_symlinks=False).st_mtime < cutoff:
                shutil.rmtree(entry.path, ignore_errors=True)
        except OSError:
            continue


def _prepare_browser_profile(lease: ExecutorLease, proxy: dict[str, str] | None) -> tuple[str, bool, bool, str]:
    root = os.environ.get("KWMEMBERSHIP_BROWSER_PROFILE_ROOT", "").strip()
    if not root:
        return tempfile.mkdtemp(prefix="kwmembership-python-"), False, False, ""
    if not os.path.isabs(root) or not SAFE_FULFILLMENT_ID.fullmatch(lease.fulfillment_id):
        raise ExecutorAPIError("BROWSER_PROFILE_CONFIG_INVALID", 503)
    os.makedirs(root, mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    root = os.path.realpath(root)
    _cleanup_stale_profiles(root)
    path = os.path.join(root, lease.fulfillment_id)
    fingerprint = _proxy_fingerprint(proxy)
    binding = _read_profile_binding(path)
    compatible = bool(binding
        and binding.get("version") == 1
        and binding.get("fulfillmentId") == lease.fulfillment_id
        and binding.get("proxyFingerprint") == fingerprint)
    if os.path.lexists(path) and (os.path.islink(path) or not compatible):
        if os.path.islink(path):
            os.unlink(path)
        elif not os.path.isdir(path):
            os.unlink(path)
        else:
            shutil.rmtree(path)
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)
    authenticated = compatible and binding.get("authenticated") is True
    _write_profile_binding(path, lease.fulfillment_id, fingerprint, authenticated)
    return path, True, authenticated, fingerprint


def _retain_profile_after_success(lease: ExecutorLease) -> bool:
    return lease.command_kind == "preflight" or (
        lease.stage == "plus" and lease.target_tier in {"x5", "x20"}
    )


class LiveExecutor:
    def execute(self, client: ExecutorClient, lease: ExecutorLease) -> None:
        try:
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as error:
            raise ExecutorAPIError("LIVE_BROWSER_UNAVAILABLE", 503) from error

        material = client.material(lease)
        if lease.adapter_version != "python-session-card-checkout-v1":
            raise ExecutorAPIError("EXECUTOR_ADAPTER_MISMATCH", 409)
        session = material.get("session")
        if not isinstance(session, dict):
            raise ExecutorAPIError("SESSION_INVALID", 409)
        expected = normalize_email(material.get("expectedEmail"))
        actual = normalize_email(session.get("user", {}).get("email") if isinstance(session.get("user"), dict) else "")
        if not actual:
            actual = normalize_email(session.get("email"))
        if not expected or not actual:
            raise ExecutorAPIError("EXPECTED_IDENTITY_MISSING", 409)
        if actual != expected:
            raise ExecutorAPIError("CHATGPT_SESSION_IDENTITY_MISMATCH", 409)
        if lease.command_kind == "payment" and not material.get("card"):
            raise ExecutorAPIError("CHECKOUT_MATERIAL_INVALID", 409)

        deadline = _execution_deadline(lease.hard_deadline_at)
        client.heartbeat(lease)
        proxy = _browser_proxy_from_env()
        user_data_dir, persistent, profile_authenticated, proxy_fingerprint = _prepare_browser_profile(lease, proxy)
        succeeded = False
        try:
            with sync_playwright() as playwright:
                launch_kwargs: dict[str, Any] = {"headless": os.environ.get("KWMEMBERSHIP_VISIBLE_BROWSER", "false") != "true"}
                executable = os.environ.get("KWMEMBERSHIP_CHROME_PATH", "").strip()
                if executable:
                    launch_kwargs["executable_path"] = executable
                if proxy:
                    launch_kwargs["proxy"] = proxy
                context = playwright.chromium.launch_persistent_context(
                    user_data_dir,
                    viewport={"width": 1280, "height": 900},
                    service_workers="block",
                    **launch_kwargs,
                )
                try:
                    if not profile_authenticated:
                        context.add_cookies(session_cookies(session, time.time()))
                    page = context.pages[0] if context.pages else context.new_page()
                    client.heartbeat(lease)
                    self._run(client, lease, material, page, deadline)
                finally:
                    context.close()
                succeeded = True
                if persistent:
                    _write_profile_binding(user_data_dir, lease.fulfillment_id, proxy_fingerprint, True)
        except ExecutorAPIError:
            raise
        except PlaywrightTimeoutError as error:
            raise ExecutorAPIError("CHECKOUT_PAGE_TIMEOUT", 409) from error
        except Exception as error:
            raise ExecutorAPIError("HEADLESS_BROWSER_UNAVAILABLE", 503) from error
        finally:
            if not persistent or not (succeeded and _retain_profile_after_success(lease)):
                shutil.rmtree(user_data_dir, ignore_errors=True)

    def _run(self, client: ExecutorClient, lease: ExecutorLease, material: dict[str, Any], page: Any, deadline: float) -> None:
        _navigate(client, lease, page, CHATGPT_ORIGIN + "/", deadline)
        identity = page.evaluate(SESSION_IDENTITY_JS)
        expected = normalize_email(material.get("expectedEmail")); actual = normalize_email(identity.get("email"))
        if identity.get("errorKind") or not actual:
            if lease.command_kind == "preflight" and _interactive_session_bootstrap_enabled():
                self._interactive_login(client, lease, page, deadline, expected)
                actual = expected
            elif identity.get("errorKind"):
                raise ExecutorAPIError("CHATGPT_SESSION_REFRESH_FAILED", 409)
            else:
                raise ExecutorAPIError("CHATGPT_SESSION_UNAUTHORIZED", 409)
        if actual != expected: raise ExecutorAPIError("CHATGPT_SESSION_IDENTITY_MISMATCH", 409)
        client.heartbeat(lease)

        if lease.command_kind == "preflight":
            entry = page.evaluate(PREPARE_PLUS_JS)
            _open_checkout_entry(client, lease, page, entry, deadline)
            try:
                page_facts = self._wait_facts(client, lease, page, deadline, "checkout")
            except ExecutorAPIError as error:
                if error.code != "CHATGPT_SESSION_UNAUTHORIZED" or not _interactive_session_bootstrap_enabled():
                    raise
                self._interactive_login(client, lease, page, deadline, expected)
                entry = page.evaluate(PREPARE_PLUS_JS)
                _open_checkout_entry(client, lease, page, entry, deadline)
                page_facts = self._wait_facts(client, lease, page, deadline, "checkout")
            if page_facts["stateId"] == "PAYMENT_ACTION_REQUIRED":
                self._handoff(client, lease, page_facts)
                page_facts = self._wait_challenge_clear(client, lease, page, deadline, "checkout")
            client.report(lease, "success", page_facts, diagnostic={"phase": "live-preflight", "stateId": page_facts["stateId"], "status": "passed"})
            return

        if lease.stage == "plus":
            entry = page.evaluate(PREPARE_PLUS_JS)
            _open_checkout_entry(client, lease, page, entry, deadline)
        else:
            _navigate(client, lease, page, CHATGPT_ORIGIN + "/settings/subscription", deadline)
            selection = self._wait_facts(client, lease, page, deadline, "selection")
            if selection["stateId"] == "PAYMENT_ACTION_REQUIRED":
                self._handoff(client, lease, selection)
                selection = self._wait_challenge_clear(client, lease, page, deadline, "selection")
            control = "upgradeX5" if lease.target_tier == "x5" else "upgradeX20"
            outcome = self._activate(client, lease, page, selection, "progression", selection["controls"].get(control, ""))
            if not outcome.get("continue", True):
                client.report(lease, "success", selection, diagnostic={"phase": "live", "stateId": selection["stateId"], "status": "stopped"})
                return
            page_facts = self._wait_facts(client, lease, page, deadline, "checkout", selection.get("structuralHash", ""))
            self._checkout(client, lease, material, page, deadline, page_facts)
            return

        self._checkout(client, lease, material, page, deadline)

    def _interactive_login(self, client: ExecutorClient, lease: ExecutorLease, page: Any, deadline: float, expected: str) -> None:
        if lease.command_kind != "preflight" or not _interactive_session_bootstrap_enabled():
            raise ExecutorAPIError("INTERACTIVE_LOGIN_DISABLED", 409)
        if os.environ.get("KWMEMBERSHIP_VISIBLE_BROWSER", "false") != "true":
            raise ExecutorAPIError("INTERACTIVE_LOGIN_DISABLED", 409)
        context = page.context
        context.clear_cookies(name=re.compile(r"^__Secure-next-auth\.session-token(?:\.\d+)?$"))
        if _path_class(page.url) != "auth":
            _navigate(client, lease, page, CHATGPT_ORIGIN + "/auth/login", deadline)
        client.handoff(lease, "interactive-login", {
            "stateId": "INTERACTIVE_LOGIN_REQUIRED",
            "origin": CHATGPT_ORIGIN,
            "routeTemplate": "/",
            "plan": "", "country": "", "currency": "", "displayedAmount": None,
            "stateMarker": "", "fields": {}, "controls": {}, "structuralHash": "",
        }, {"phase": "interactive-login", "stateId": "INTERACTIVE_LOGIN_REQUIRED", "status": "action_required"})
        last_heartbeat = 0.0
        while time.time() < deadline:
            if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
                client.heartbeat(lease)
                last_heartbeat = time.monotonic()
            if urlsplit(page.url).scheme + "://" + urlsplit(page.url).netloc == CHATGPT_ORIGIN:
                identity = page.evaluate(SESSION_IDENTITY_JS)
                actual = normalize_email(identity.get("email")) if not identity.get("errorKind") else ""
                if actual:
                    if actual != expected:
                        raise ExecutorAPIError("INTERACTIVE_LOGIN_IDENTITY_MISMATCH", 409)
                    _navigate(client, lease, page, CHATGPT_ORIGIN + "/", deadline)
                    return
            time.sleep(POLL_SECONDS)
        raise ExecutorAPIError("INTERACTIVE_LOGIN_TIMEOUT", 409)

    def _checkout(self, client: ExecutorClient, lease: ExecutorLease, material: dict[str, Any], page: Any, deadline: float, initial: dict[str, Any] | None = None) -> None:
        seen: set[str] = set()
        pending = initial
        for _ in range(MAX_TRANSITIONS):
            facts = pending or self._wait_facts(client, lease, page, deadline, "checkout")
            pending = None
            if facts["stateId"] == "PAYMENT_ACTION_REQUIRED":
                self._handoff(client, lease, facts)
                facts = self._wait_challenge_clear(client, lease, page, deadline, "checkout")
            key = facts["stateId"] + ":" + facts["structuralHash"]
            if key in seen: raise ExecutorAPIError("PAYMENT_REPEATED_STATE", 409)
            seen.add(key)
            if facts["stateId"] not in {"PAYMENT_CARD_ENTRY_READY", "PAYMENT_PROGRESSION_READY", "PAYMENT_FINAL_READY"}:
                raise ExecutorAPIError("CHECKOUT_UI_UNSUPPORTED", 409)
            if facts["stateId"] == "PAYMENT_CARD_ENTRY_READY":
                _fill_card_frames(page, material)
                pending = self._wait_facts(client, lease, page, deadline, "checkout", facts["structuralHash"])
                continue
            _fill_frames(page, material)
            refreshed = self._wait_facts(client, lease, page, deadline, "checkout")
            if refreshed["stateId"] == "PAYMENT_ACTION_REQUIRED":
                self._handoff(client, lease, refreshed)
                pending = self._wait_challenge_clear(client, lease, page, deadline, "checkout")
                continue
            if refreshed["stateId"] == "PAYMENT_PROGRESSION_READY":
                outcome = self._activate(client, lease, page, refreshed, "progression", refreshed["controls"].get("progression", ""))
                if not outcome.get("continue", True):
                    client.report(lease, "success", refreshed, diagnostic={"phase": "live", "stateId": refreshed["stateId"], "status": "stopped"})
                    return
                pending = self._wait_facts(client, lease, page, deadline, "checkout", refreshed["structuralHash"])
                continue
            self._activate(client, lease, page, refreshed, "submit", refreshed["controls"].get("submit", ""))
            # Submit activation is the financial boundary. Return the last
            # validated page immediately; Go owns post-submit reconciliation
            # and will classify any later challenge or unknown outcome.
            client.report(lease, "success", refreshed, diagnostic={"phase": "live", "stateId": refreshed["stateId"], "status": "submitted"})
            return
        raise ExecutorAPIError("PAYMENT_TRANSITION_LIMIT", 409)

    def _wait_facts(self, client: ExecutorClient, lease: ExecutorLease, page: Any, deadline: float, purpose: str, previous_hash: str = "") -> dict[str, Any]:
        last_heartbeat = 0.0
        last: dict[str, Any] | None = None
        observed = ""
        auth_redirect_started = 0.0
        while time.time() < deadline:
            if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
                client.heartbeat(lease); last_heartbeat = time.monotonic()
            raw = _inspect(page, lease, purpose)
            fact_diagnostic = _sanitized_fact_diagnostic(raw, page.url)
            diagnostic = json.dumps(fact_diagnostic, sort_keys=True, separators=(",", ":"))
            if diagnostic != observed:
                LOGGER.info("execution=%s stage=%s checkout_facts=%s", lease.execution_id, lease.stage, diagnostic)
                observed = diagnostic
            if fact_diagnostic["pathClass"] == "auth":
                auth_redirect_started = auth_redirect_started or time.monotonic()
                if time.monotonic() - auth_redirect_started >= AUTH_REDIRECT_GRACE_SECONDS:
                    raise ExecutorAPIError("CHATGPT_SESSION_UNAUTHORIZED", 409)
                time.sleep(POLL_SECONDS)
                continue
            else:
                auth_redirect_started = 0.0
            if raw.get("stateId") == "PAYMENT_ACTION_REQUIRED":
                return raw
            if raw.get("origin") in {CHATGPT_ORIGIN, PAY_ORIGIN} and raw.get("routeTemplate"):
                try:
                    validated = client.page_facts(lease, raw)["page"]
                    last = validated
                    if validated["stateId"] != "UNKNOWN_PAYMENT_STATE" and (not previous_hash or validated["structuralHash"] != previous_hash or validated["stateId"] == "PAYMENT_ACTION_REQUIRED"):
                        return validated
                except ExecutorAPIError as error:
                    if error.code not in {"CHECKOUT_PAGE_CONTRACT_INVALID", "CHECKOUT_CONTEXT_INVALID"}:
                        raise
            time.sleep(POLL_SECONDS)
        if last and last.get("stateId") == "PAYMENT_ACTION_REQUIRED":
            raise ExecutorAPIError("SECURITY_CHALLENGE_TIMEOUT", 409)
        raise ExecutorAPIError("CHECKOUT_PAGE_TIMEOUT", 409)

    def _wait_challenge_clear(self, client: ExecutorClient, lease: ExecutorLease, page: Any, deadline: float, purpose: str) -> dict[str, Any]:
        last_heartbeat = 0.0
        auth_redirect_started = 0.0
        while time.time() < deadline:
            if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
                client.heartbeat(lease)
                last_heartbeat = time.monotonic()
            raw = _inspect(page, lease, purpose)
            if _path_class(page.url) == "auth":
                auth_redirect_started = auth_redirect_started or time.monotonic()
                if time.monotonic() - auth_redirect_started >= AUTH_REDIRECT_GRACE_SECONDS:
                    raise ExecutorAPIError("CHATGPT_SESSION_UNAUTHORIZED", 409)
                time.sleep(POLL_SECONDS)
                continue
            auth_redirect_started = 0.0
            if raw.get("stateId") == "PAYMENT_ACTION_REQUIRED":
                time.sleep(POLL_SECONDS)
                continue
            if raw.get("origin") in {CHATGPT_ORIGIN, PAY_ORIGIN} and raw.get("routeTemplate"):
                try:
                    return client.page_facts(lease, raw)["page"]
                except ExecutorAPIError as error:
                    if error.code not in {"CHECKOUT_PAGE_CONTRACT_INVALID", "CHECKOUT_CONTEXT_INVALID"}:
                        raise
            time.sleep(POLL_SECONDS)
        raise ExecutorAPIError("SECURITY_CHALLENGE_TIMEOUT", 409)

    def _activate(self, client: ExecutorClient, lease: ExecutorLease, page: Any, facts: dict[str, Any], kind: str, control_id: str) -> dict[str, Any]:
        if not control_id: raise ExecutorAPIError("CHECKOUT_ACTION_INVALID", 409)
        permit = client.prepare_action(lease, kind, control_id, facts).get("permitId")
        if not isinstance(permit, str) or not permit: raise ExecutorAPIError("CHECKOUT_ACTION_INVALID", 409)
        client.activate_action(lease, permit)
        activated = _activate_frames(page, control_id)
        if not activated:
            client.action_result(lease, permit, "not-clicked")
            raise ExecutorAPIError("PERMIT_ACTIVATION_UNCERTAIN", 409)
        return client.action_result(lease, permit, "clicked")

    def _handoff(self, client: ExecutorClient, lease: ExecutorLease, facts: dict[str, Any]) -> None:
        challenge = facts.get("controls", {}).get("challenge") or "challenge-captcha"
        handoff_type = {"challenge-cloudflare": "cloudflare", "challenge-3ds": "3ds", "challenge-sms": "sms", "challenge-bank": "bank"}.get(challenge, "captcha")
        client.handoff(lease, handoff_type, facts, {"phase": "challenge", "stateId": facts.get("stateId", ""), "status": "action_required"})


def _deadline(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _execution_deadline(value: str) -> float:
    return _deadline(value) - REPORT_MARGIN_SECONDS


def _remaining_ms(deadline: float) -> int:
    remaining = int((deadline - time.time()) * 1000)
    if remaining <= 0: raise ExecutorAPIError("EXECUTOR_LEASE_EXPIRED", 409)
    return max(1000, remaining)


def _navigate(client: ExecutorClient, lease: ExecutorLease, page: Any, value: str, deadline: float) -> None:
    client.heartbeat(lease)
    page.goto(value, wait_until="commit", timeout=min(15000, _remaining_ms(deadline)))
    client.heartbeat(lease)


def _resolve_checkout_entry(entry: Any) -> str | None:
    if not isinstance(entry, dict): raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)
    error_kind = entry.get("errorKind")
    if error_kind:
        if error_kind == "custom_checkout_material_invalid":
            violation = entry.get("contractViolation")
            if violation not in {"checkout_session_id", "publishable_key", "client_secret", "processor_entity"}:
                violation = "unknown"
            LOGGER.warning("custom checkout response rejected field=%s", violation)
        code = {
            "already_subscribed": "CHATGPT_ACCOUNT_ALREADY_SUBSCRIBED",
            "session_unavailable": "CHATGPT_SESSION_REFRESH_FAILED",
            "access_token_unavailable": "CHATGPT_SESSION_REFRESH_FAILED",
            "checkout_unauthorized": "CHECKOUT_API_AUTH_FAILED",
            "context_invalid": "CHECKOUT_CONTEXT_INVALID",
            "checkout_rejected": "CHECKOUT_ENTRY_UNAVAILABLE",
            "checkout_unavailable": "CHECKOUT_ENTRY_UNAVAILABLE",
            "custom_checkout_material_invalid": "CHECKOUT_API_CONTRACT_DRIFT",
        }.get(str(error_kind), "CHECKOUT_API_CONTRACT_DRIFT")
        raise ExecutorAPIError(code, 409)
    tag = entry.get("responseTag")
    if tag == "hosted_checkout_session":
        if not isinstance(entry.get("checkoutURL"), str) or entry.get("processorEntity") or entry.get("checkoutSessionID"): raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)
        return validate_checkout_url(entry["checkoutURL"])
    if tag == "custom_checkout_session":
        if (entry.get("checkoutURL") or entry.get("processorEntity") != "openai_llc"
                or entry.get("checkoutSessionID") or entry.get("customMaterialReady") is not True
                or entry.get("checkoutSessionClass") not in {"oaics_", "cs_"}):
            raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)
        return None
    raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)


def _open_checkout_entry(
    client: ExecutorClient, lease: ExecutorLease, page: Any, entry: Any, deadline: float
) -> None:
    checkout_url = _resolve_checkout_entry(entry)
    if checkout_url is not None:
        _log_checkout_entry(lease, entry, checkout_url)
        _navigate(client, lease, page, checkout_url, deadline)
        return
    _log_checkout_entry(lease, entry, CHATGPT_ORIGIN + "/checkout")
    client.heartbeat(lease)
    mounted = page.evaluate(MOUNT_CUSTOM_CHECKOUT_JS)
    client.heartbeat(lease)
    if not isinstance(mounted, dict):
        raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)
    error_kind = mounted.get("errorKind")
    if error_kind:
        code = {
            "context_invalid": "CHECKOUT_CONTEXT_INVALID",
            "custom_checkout_material_missing": "CHECKOUT_API_CONTRACT_DRIFT",
            "checkout_session_contract_invalid": "CHECKOUT_PAGE_CONTRACT_INVALID",
            "stripe_unavailable": "CHECKOUT_ENTRY_UNAVAILABLE",
            "stripe_checkout_unavailable": "CHECKOUT_ENTRY_UNAVAILABLE",
            "checkout_session_unavailable": "CHECKOUT_ENTRY_UNAVAILABLE",
            "custom_checkout_unavailable": "CHECKOUT_ENTRY_UNAVAILABLE",
        }.get(str(error_kind), "CHECKOUT_API_CONTRACT_DRIFT")
        raise ExecutorAPIError(code, 409)
    if mounted.get("mounted") is not True:
        raise ExecutorAPIError("CHECKOUT_API_CONTRACT_DRIFT", 409)


def _log_checkout_entry(lease: ExecutorLease, entry: dict[str, Any], checkout_url: str) -> None:
    diagnostic = {
        "responseTag": str(entry.get("responseTag") or ""),
        "origin": f"{urlsplit(checkout_url).scheme}://{urlsplit(checkout_url).netloc}",
        "routeTemplate": route_template(checkout_url),
    }
    LOGGER.info(
        "execution=%s stage=%s checkout_entry=%s",
        lease.execution_id,
        lease.stage,
        json.dumps(diagnostic, sort_keys=True, separators=(",", ":")),
    )


def _inspect(page: Any, lease: ExecutorLease, purpose: str) -> dict[str, Any]:
    frames = []
    for frame in page.frames:
        try:
            fact = frame.evaluate(INSPECT_FRAME_JS)
        except Exception:
            continue
        if isinstance(fact, dict) and fact.get("origin"):
            frames.append(fact)
    top_origin = f"{urlsplit(page.url).scheme}://{urlsplit(page.url).netloc}"
    top_route = route_template(page.url)
    top = [fact for fact in frames if fact.get("origin") == top_origin]
    currency = _unique(top, "currency")
    amount = _contract_amount(top, lease)
    country = _unique(top, "country")
    if not country and currency == "PHP" and amount is not None:
        country = "PH"
    page_data: dict[str, Any] = {"origin": top_origin, "routeTemplate": top_route, "plan": _unique(top, "plan"), "country": country, "currency": currency, "displayedAmount": amount, "stateMarker": _unique(top, "stateMarker"), "fields": {}, "controls": {}}
    for fact in frames:
        for key, value in fact.get("fields", {}).items(): page_data["fields"][key] = page_data["fields"].get(key, False) or bool(value)
    for key in ("progression", "submit", "upgradeX5", "upgradeX20", "challenge"):
        values = [fact.get("controls", {}).get(key) for fact in top if fact.get("controls", {}).get(key)]
        if len(set(values)) == 1: page_data["controls"][key] = values[0]
    page_data = _restrict_pre_route_challenge_controls(page_data)
    page_data["stateId"] = _classify(page_data, lease, purpose)
    page_data["structuralHash"] = structural_hash(page_data)
    return page_data


def _restrict_pre_route_challenge_controls(page: dict[str, Any]) -> dict[str, Any]:
    controls = page.get("controls", {})
    if (page.get("origin") == CHATGPT_ORIGIN and not page.get("routeTemplate")
            and controls.get("challenge") == "challenge-cloudflare"):
        return {**page, "controls": {"challenge": "challenge-cloudflare"}}
    return page


def _classify(page: dict[str, Any], lease: ExecutorLease, purpose: str) -> str:
    if page.get("controls", {}).get("challenge") == "challenge-cloudflare": return "PAYMENT_ACTION_REQUIRED"
    expected_plan = "plus" if lease.stage != "upgrade" else ({"x5": "prolite", "x20": "pro"}.get(lease.target_tier, ""))
    contract = lease.price_contract
    amount = page.get("displayedAmount")
    base = page.get("plan") == expected_plan and page.get("country") == "PH" and page.get("currency") == "PHP" and isinstance(amount, (int, float)) and float(contract["MinAmount"]) <= amount <= float(contract["MaxAmount"])
    if purpose == "selection":
        if not base or page.get("origin") != CHATGPT_ORIGIN or page.get("routeTemplate") != "/settings/subscription": return "UNKNOWN_PAYMENT_STATE"
        if page.get("controls", {}).get("challenge"): return "PAYMENT_ACTION_REQUIRED"
        control = "upgradeX5" if lease.target_tier == "x5" else "upgradeX20"
        return "UPGRADE_SELECTION_READY" if page.get("controls", {}).get(control) == ("upgrade-x5" if control == "upgradeX5" else "upgrade-x20") else "UNKNOWN_PAYMENT_STATE"
    if not base or page.get("routeTemplate") not in {"/checkout", "/checkout/{id}", "/pay/{id}"}: return "UNKNOWN_PAYMENT_STATE"
    if page.get("controls", {}).get("challenge"): return "PAYMENT_ACTION_REQUIRED"
    fields = page.get("fields", {}); controls = page.get("controls", {})
    card = fields.get("cardNumber") and fields.get("cvc") and (fields.get("expiry") or fields.get("expiryMonth") and fields.get("expiryYear"))
    billing = fields.get("billingName") and fields.get("billingCountry") and fields.get("billingPostal")
    address = sum(bool(fields.get(key)) for key in ("billingLine1", "billingCity", "billingState"))
    if not card or (bool(controls.get("progression")) == bool(controls.get("submit"))): return "UNKNOWN_PAYMENT_STATE"
    billing_complete = billing and address in {0, 3}
    if controls.get("submit") and not billing_complete: return "PAYMENT_CARD_ENTRY_READY"
    if not billing_complete: return "UNKNOWN_PAYMENT_STATE"
    return "PAYMENT_PROGRESSION_READY" if controls.get("progression") else "PAYMENT_FINAL_READY"


def _unique(items: list[dict[str, Any]], key: str) -> Any:
    values = {item.get(key) for item in items if item.get(key) not in (None, "")}
    return values.pop() if len(values) == 1 else ""


def _contract_amount(items: list[dict[str, Any]], lease: ExecutorLease) -> float | None:
    values: set[float] = set()
    for item in items:
        candidates = list(item.get("displayedAmounts") or [])
        if item.get("displayedAmount") is not None:
            candidates.append(item["displayedAmount"])
        for candidate in candidates:
            if isinstance(candidate, (int, float)) and float(lease.price_contract["MinAmount"]) <= candidate <= float(lease.price_contract["MaxAmount"]):
                values.add(float(candidate))
    return values.pop() if len(values) == 1 else None


def _sanitized_fact_diagnostic(page: dict[str, Any], page_url: str = "") -> dict[str, Any]:
    return {
        "stateId": str(page.get("stateId") or ""),
        "origin": str(page.get("origin") or ""),
        "routeTemplate": str(page.get("routeTemplate") or ""),
        "plan": str(page.get("plan") or ""),
        "country": str(page.get("country") or ""),
        "currency": str(page.get("currency") or ""),
        "displayedAmount": page.get("displayedAmount") if isinstance(page.get("displayedAmount"), (int, float)) else None,
        "pathClass": _path_class(page_url),
        "fields": [key for key in FACT_FIELD_KEYS if page.get("fields", {}).get(key) is True],
        "controls": {key: str(page.get("controls", {}).get(key)) for key in FACT_CONTROL_KEYS if page.get("controls", {}).get(key)},
    }


def _path_class(value: str) -> str:
    route = route_template(value) if value else ""
    if route:
        return route
    path = urlsplit(value).path.rstrip("/") if value else ""
    if path == "":
        return "root"
    if path.startswith("/auth") or path.startswith("/login"):
        return "auth"
    if path.startswith("/checkout"):
        return "checkout-unrecognized"
    if path.startswith("/cdn-cgi"):
        return "challenge"
    return "other"


def _fill_frames(page: Any, material: dict[str, Any]) -> None:
    card = material.get("card", {}); billing = material.get("billing", {})
    year = str(card.get("ExpiryYear", card.get("expiryYear", "")))
    fragment = {**_card_fragment(card, year), "billingName": str(billing.get("Name", billing.get("name", ""))), "billingLine1": str(billing.get("Line1", billing.get("line1", ""))), "billingCity": str(billing.get("City", billing.get("city", ""))), "billingState": str(billing.get("State", billing.get("state", ""))), "billingCountry": str(billing.get("Country", billing.get("country", ""))), "billingPostal": str(billing.get("PostalCode", billing.get("postalCode", "")))}
    filled = _fill_fragment(page, fragment)
    if not (_card_complete(filled) and {"billingName", "billingCountry", "billingPostal"} <= filled):
        raise ExecutorAPIError("PAYMENT_FIELDS_NOT_FILLED", 409)


def _fill_card_frames(page: Any, material: dict[str, Any]) -> None:
    card = material.get("card", {})
    year = str(card.get("ExpiryYear", card.get("expiryYear", "")))
    if not _card_complete(_fill_fragment(page, _card_fragment(card, year))):
        raise ExecutorAPIError("PAYMENT_FIELDS_NOT_FILLED", 409)


def _card_fragment(card: dict[str, Any], year: str) -> dict[str, str]:
    return {"cardNumber": str(card.get("Number", card.get("number", ""))), "expiry": str(card.get("ExpiryMonth", card.get("expiryMonth", ""))) + "/" + year[-2:], "expiryMonth": str(card.get("ExpiryMonth", card.get("expiryMonth", ""))), "expiryYear": year, "cvc": str(card.get("CVV", card.get("cvv", "")))}


def _fill_fragment(page: Any, fragment: dict[str, str]) -> set[str]:
    filled: set[str] = set()
    for frame in page.frames:
        try:
            result = frame.evaluate(FILL_FRAME_JS, fragment)
            filled.update(result.get("filled", []))
        except Exception:
            continue
    return filled


def _card_complete(filled: set[str]) -> bool:
    return "cardNumber" in filled and "cvc" in filled and ("expiry" in filled or {"expiryMonth", "expiryYear"} <= filled)


def _activate_frames(page: Any, control_id: str) -> bool:
    selectors = CONTROL_SELECTORS.get(control_id, ())
    for frame in page.frames:
        if urlsplit(frame.url).scheme + "://" + urlsplit(frame.url).netloc not in {CHATGPT_ORIGIN, PAY_ORIGIN}:
            continue
        for selector in selectors:
            try:
                locator = frame.locator(selector)
                if locator.count() != 1 or not locator.is_visible() or not locator.is_enabled():
                    continue
                locator.click(timeout=3000)
                return True
            except Exception:
                continue
    return False
