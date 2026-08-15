from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from python_executor.client import ExecutorAPIError, ExecutorLease
from python_executor.live import (
    INSPECT_FRAME_JS,
    LiveExecutor,
    MOUNT_CUSTOM_CHECKOUT_JS,
    PREPARE_PLUS_JS,
    SESSION_IDENTITY_JS,
    _interactive_session_bootstrap_enabled,
    _prepare_browser_profile,
    _read_profile_binding,
    _retain_profile_after_success,
    _browser_proxy_from_env,
    _classify,
    _contract_amount,
    _fill_card_frames,
    _restrict_pre_route_challenge_controls,
    _sanitized_fact_diagnostic,
    _execution_deadline,
    _path_class,
    _resolve_checkout_entry,
    route_template,
    session_cookies,
    validate_checkout_url,
)


def lease(stage: str = "plus", target_tier: str = "plus", command_kind: str = "payment") -> ExecutorLease:
    return ExecutorLease(
        execution_id="exec-1",
        fulfillment_id="mf-test-1",
        executor_id="python-test",
        lease_epoch=1,
        lease_token="opaque",
        hard_deadline_at="2026-08-13T00:05:00Z",
        command_kind=command_kind,
        stage=stage,
        attempt_no=1,
        target_tier=target_tier,
        adapter_version="python-session-card-checkout-v1",
        price_contract={"MinAmount": 1000, "MaxAmount": 1200},
    )


class LiveContractTest(unittest.TestCase):
    def test_interactive_login_reuses_page_and_requires_expected_identity(self) -> None:
        calls: list[object] = []

        class Context:
            def clear_cookies(self, **filters: object) -> None:
                calls.append(("clear", filters))

        class Page:
            url = "https://chatgpt.com/auth/login"
            context = Context()

            def evaluate(self, _script: str) -> dict[str, str]:
                calls.append("identity")
                return {"email": "buyer@example.com", "errorKind": ""}

            def goto(self, value: str, **_options: object) -> None:
                calls.append(("goto", value))
                self.url = value

        class Client:
            def handoff(self, _lease: ExecutorLease, kind: str, facts: dict[str, object], _diagnostic: dict[str, str]) -> None:
                calls.append(("handoff", kind, facts["stateId"]))

            def heartbeat(self, _lease: ExecutorLease) -> None:
                calls.append("heartbeat")

        with patch.dict(os.environ, {
            "KWMEMBERSHIP_VISIBLE_BROWSER": "true",
            "KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP": "true",
        }, clear=True), patch(
            "python_executor.live.time.sleep"
        ):
            LiveExecutor()._interactive_login(
                Client(), lease(command_kind="preflight"), Page(), time.time() + 60, "buyer@example.com"
            )

        self.assertIn(("handoff", "interactive-login", "INTERACTIVE_LOGIN_REQUIRED"), calls)
        self.assertIn(("goto", "https://chatgpt.com/"), calls)
        self.assertEqual(calls.count("identity"), 1)

    def test_interactive_login_rejects_a_different_account(self) -> None:
        class Context:
            def clear_cookies(self, **_filters: object) -> None:
                pass

        class Page:
            url = "https://chatgpt.com/auth/login"
            context = Context()

            def evaluate(self, _script: str) -> dict[str, str]:
                return {"email": "other@example.com", "errorKind": ""}

        class Client:
            def handoff(self, *_args: object) -> None:
                pass

            def heartbeat(self, _lease: ExecutorLease) -> None:
                pass

        with patch.dict(os.environ, {
            "KWMEMBERSHIP_VISIBLE_BROWSER": "true",
            "KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP": "true",
        }, clear=True), self.assertRaises(
            ExecutorAPIError
        ) as raised:
            LiveExecutor()._interactive_login(
                Client(), lease(command_kind="preflight"), Page(), time.time() + 60, "buyer@example.com"
            )
        self.assertEqual(raised.exception.code, "INTERACTIVE_LOGIN_IDENTITY_MISMATCH")

    def test_interactive_login_is_never_allowed_for_payment_commands(self) -> None:
        with patch.dict(os.environ, {
            "KWMEMBERSHIP_VISIBLE_BROWSER": "true",
            "KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP": "true",
        }, clear=True), self.assertRaises(ExecutorAPIError) as raised:
            LiveExecutor()._interactive_login(
                object(), lease(command_kind="payment"), object(), time.time() + 60, "buyer@example.com"
            )
        self.assertEqual(raised.exception.code, "INTERACTIVE_LOGIN_DISABLED")

    def test_interactive_session_bootstrap_is_explicitly_enabled(self) -> None:
        with patch.dict(os.environ, {"KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP": "true"}, clear=True):
            self.assertTrue(_interactive_session_bootstrap_enabled())
        for value in ("", "false", "TRUE", "1"):
            with self.subTest(value=value), patch.dict(os.environ, {
                "KWMEMBERSHIP_INTERACTIVE_SESSION_BOOTSTRAP": value
            }, clear=True):
                self.assertFalse(_interactive_session_bootstrap_enabled())

    def test_order_profile_reuses_only_the_same_proxy_binding(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            "KWMEMBERSHIP_BROWSER_PROFILE_ROOT": root
        }, clear=True):
            item = lease(command_kind="preflight")
            path, persistent, authenticated, fingerprint = _prepare_browser_profile(
                item, {"server": "http://proxy.example:3000", "username": "user", "password": "secret"}
            )
            self.assertTrue(persistent)
            self.assertFalse(authenticated)
            self.assertNotIn("secret", json.dumps(_read_profile_binding(path)))
            from python_executor.live import _write_profile_binding
            _write_profile_binding(path, item.fulfillment_id, fingerprint, True)
            same_path, _, authenticated, _ = _prepare_browser_profile(
                item, {"server": "http://proxy.example:3000", "username": "user", "password": "secret"}
            )
            self.assertEqual(same_path, path)
            self.assertTrue(authenticated)
            _, _, authenticated, _ = _prepare_browser_profile(
                item, {"server": "http://other-proxy.example:3000", "username": "user", "password": "secret"}
            )
            self.assertFalse(authenticated)

    def test_profile_is_retained_only_until_the_final_stage(self) -> None:
        self.assertTrue(_retain_profile_after_success(lease(command_kind="preflight")))
        self.assertFalse(_retain_profile_after_success(lease(command_kind="payment")))
        self.assertTrue(_retain_profile_after_success(lease(target_tier="x20", command_kind="payment")))
        self.assertFalse(_retain_profile_after_success(lease(
            stage="upgrade", target_tier="x20", command_kind="payment"
        )))

    def test_cloudflare_detection_requires_an_active_challenge_surface(self) -> None:
        for marker in (
            "#challenge-form",
            "#challenge-running",
            'input[name="cf-turnstile-response"]',
            'iframe[src*="challenges.cloudflare.com"]',
        ):
            self.assertIn(marker, INSPECT_FRAME_JS)
        self.assertNotIn('/cdn-cgi/challenge-platform/', INSPECT_FRAME_JS)

    def test_plus_checkout_scopes_requests_to_the_chatgpt_account(self) -> None:
        self.assertIn("headers['ChatGPT-Account-ID'] = accountID", PREPARE_PLUS_JS)
        self.assertIn("/backend-api/payments/checkout", PREPARE_PLUS_JS)

    def test_custom_checkout_uses_stripe_elements_without_redirecting(self) -> None:
        self.assertIn("__kwmembershipCustomCheckout", PREPARE_PLUS_JS)
        self.assertIn("https://js.stripe.com/dahlia/stripe.js", MOUNT_CUSTOM_CHECKOUT_JS)
        self.assertIn("initCheckoutElementsSdk", MOUNT_CUSTOM_CHECKOUT_JS)
        self.assertIn("checkout.loadActions()", MOUNT_CUSTOM_CHECKOUT_JS)
        self.assertIn("minorUnitsAmountDivisor", MOUNT_CUSTOM_CHECKOUT_JS)
        self.assertIn("actions.confirm()", MOUNT_CUSTOM_CHECKOUT_JS)
        self.assertNotIn("redirectToCheckout", MOUNT_CUSTOM_CHECKOUT_JS)

    def test_builds_authenticated_browser_proxy_from_separate_secrets(self) -> None:
        with patch.dict(os.environ, {
            "KWMEMBERSHIP_CHROME_PROXY_SERVER": "http://proxy.example:3000",
            "KWMEMBERSHIP_CHROME_PROXY_USERNAME": "proxy-user",
            "KWMEMBERSHIP_CHROME_PROXY_PASSWORD": "proxy-password",
        }, clear=True):
            self.assertEqual(_browser_proxy_from_env(), {
                "server": "http://proxy.example:3000",
                "username": "proxy-user",
                "password": "proxy-password",
            })

    def test_browser_proxy_credentials_must_be_complete(self) -> None:
        with patch.dict(os.environ, {
            "KWMEMBERSHIP_CHROME_PROXY_SERVER": "http://proxy.example:3000",
            "KWMEMBERSHIP_CHROME_PROXY_USERNAME": "proxy-user",
        }, clear=True), self.assertRaises(ExecutorAPIError) as raised:
            _browser_proxy_from_env()
        self.assertEqual(raised.exception.code, "CHROME_PROXY_CONFIG_INVALID")

    def test_supports_browser_proxy_without_credentials(self) -> None:
        with patch.dict(os.environ, {
            "KWMEMBERSHIP_CHROME_PROXY_SERVER": "http://127.0.0.1:7890",
        }, clear=True):
            self.assertEqual(_browser_proxy_from_env(), {"server": "http://127.0.0.1:7890"})

    def test_reserves_time_to_close_browser_and_report_before_hard_deadline(self) -> None:
        self.assertEqual(
            _execution_deadline("2026-08-13T00:05:00Z"),
            1_786_579_485.0,
        )

    def test_chunks_session_cookie_like_go_provider(self) -> None:
        cookies = session_cookies(
            {"sessionToken": "x" * 4400, "expires": "2026-08-14T00:00:00Z"},
            now=1_786_579_200,
        )
        self.assertEqual([cookie["name"] for cookie in cookies], [
            "__Secure-next-auth.session-token.0",
            "__Secure-next-auth.session-token.1",
        ])
        self.assertEqual([len(cookie["value"]) for cookie in cookies], [3936, 464])
        self.assertTrue(all(cookie["httpOnly"] and cookie["secure"] for cookie in cookies))

    def test_checkout_url_allowlist_rejects_credentials_and_foreign_hosts(self) -> None:
        allowed = "https://chatgpt.com/checkout/openai_llc/oaics_safe_123"
        self.assertEqual(validate_checkout_url(allowed), allowed)
        self.assertEqual(route_template(allowed), "/checkout/{id}")
        for value in (
            "https://chatgpt.com.evil.example/checkout/oaics_safe",
            "https://user@chatgpt.com/checkout/oaics_safe",
            "http://chatgpt.com/checkout/oaics_safe",
            "https://chatgpt.com/checkout/openai_other/oaics_safe",
        ):
            with self.subTest(value=value), self.assertRaises(ExecutorAPIError):
                validate_checkout_url(value)

    def test_resolves_only_supported_checkout_response_contracts(self) -> None:
        self.assertEqual(
            _resolve_checkout_entry({
                "responseTag": "custom_checkout_session",
                "checkoutURL": "",
                "processorEntity": "openai_llc",
                "checkoutSessionID": "",
                "checkoutSessionClass": "cs_",
                "customMaterialReady": True,
                "errorKind": "",
            }),
            None,
        )
        with self.assertRaises(ExecutorAPIError) as raised:
            _resolve_checkout_entry({"errorKind": "already_subscribed"})
        self.assertEqual(raised.exception.code, "CHATGPT_ACCOUNT_ALREADY_SUBSCRIBED")
        with self.assertLogs("kwmembership.python_executor.live", level="WARNING") as captured:
            with self.assertRaises(ExecutorAPIError) as raised:
                _resolve_checkout_entry({
                    "responseTag": "custom_checkout_session",
                    "checkoutURL": "",
                    "processorEntity": "openai_llc",
                    "checkoutSessionID": "",
                    "checkoutSessionClass": "cs_",
                    "customMaterialReady": False,
                    "contractViolation": "client_secret",
                    "errorKind": "custom_checkout_material_invalid",
                })
        self.assertEqual(raised.exception.code, "CHECKOUT_API_CONTRACT_DRIFT")
        self.assertEqual(captured.output, [
            "WARNING:kwmembership.python_executor.live:custom checkout response rejected field=client_secret"
        ])

    def test_custom_checkout_accepts_material_without_request_echoes(self) -> None:
        for session_prefix in ("cs", "oaics"):
            session_id = f"{session_prefix}_fixture"
            client_secret = f"{session_prefix}_fixture_secret_fixture"
            node_program = f"""
const prepare = {json.dumps(PREPARE_PLUS_JS)};
global.location = {{origin: 'https://chatgpt.com'}};
global.window = {{}};
global.fetch = async (url, options = {{}}) => {{
  if (url === '/api/auth/session') return {{
    ok: true,
    status: 200,
    json: async () => ({{accessToken: 'header.e30.signature', account: {{id: 'acct_fixture'}}}}),
  }};
  if (String(url).startsWith('/backend-api/subscriptions?')) return {{
    ok: true,
    status: 200,
    json: async () => ({{plan_type: 'free'}}),
  }};
  if (url === '/backend-api/payments/checkout') {{
    const request = JSON.parse(options.body);
    if (request.billing_details?.country !== 'PH'
        || request.billing_details?.currency !== 'PHP'
        || request.plan_name !== 'chatgptplusplan') {{
      throw new Error('checkout request context drifted');
    }}
    return {{
      ok: true,
      status: 200,
      json: async () => ({{
        tag: 'custom_checkout_session',
        processor_entity: 'openai_llc',
        checkout_session_id: {json.dumps(session_id)},
        publishable_key: 'pk_live_fixture',
        client_secret: {json.dumps(client_secret)},
      }}),
    }};
  }}
  throw new Error(`unexpected URL: ${{url}}`);
}};
(async () => {{
  const result = await eval(`(${{prepare}})()`);
  process.stdout.write(JSON.stringify(result));
}})().catch((error) => {{
  process.stderr.write(String(error));
  process.exitCode = 1;
}});
"""
            with self.subTest(session_prefix=session_prefix):
                completed = subprocess.run(
                    ["node", "-e", node_program],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                result = json.loads(completed.stdout)
                self.assertEqual(result["errorKind"], "")
                self.assertTrue(result["customMaterialReady"])
                self.assertEqual(result["checkoutSessionClass"], f"{session_prefix}_")
                self.assertEqual(result["checkoutSessionID"], "")
                self.assertNotIn("pk_live_fixture", completed.stdout)
                self.assertNotIn(client_secret, completed.stdout)

    def test_custom_checkout_mounts_without_opening_a_chatgpt_checkout_route(self) -> None:
        navigations: list[str] = []

        class Client:
            def heartbeat(self, _lease: ExecutorLease) -> None:
                pass

            def report(self, *_args: object, **_kwargs: object) -> None:
                pass

        class Page:
            url = "https://chatgpt.com/"

            def __init__(self) -> None:
                self.scripts: list[str] = []

            def evaluate(self, script: str) -> dict[str, object]:
                self.scripts.append(script)
                if script == SESSION_IDENTITY_JS:
                    return {"email": "buyer@example.com", "errorKind": ""}
                if script == PREPARE_PLUS_JS:
                    return {
                        "responseTag": "custom_checkout_session",
                        "checkoutURL": "",
                        "processorEntity": "openai_llc",
                        "checkoutSessionID": "",
                        "checkoutSessionClass": "cs_",
                        "customMaterialReady": True,
                        "errorKind": "",
                    }
                if script == MOUNT_CUSTOM_CHECKOUT_JS:
                    return {"mounted": True}
                raise AssertionError("unexpected browser script")

        page = Page()

        def navigate(_client: object, _lease: ExecutorLease, target: Page, value: str, _deadline: float) -> None:
            navigations.append(value)
            target.url = value

        facts = {
            "stateId": "PAYMENT_CARD_ENTRY_READY",
            "origin": "https://chatgpt.com",
            "routeTemplate": "/checkout",
            "plan": "plus",
            "country": "PH",
            "currency": "PHP",
            "displayedAmount": 1100,
            "fields": {"cardNumber": True, "expiry": True, "cvc": True},
            "controls": {"submit": "hosted-payment-submit"},
            "structuralHash": "0" * 64,
        }
        with patch("python_executor.live._navigate", side_effect=navigate), patch.object(
            LiveExecutor, "_wait_facts", return_value=facts
        ):
            LiveExecutor()._run(
                Client(),
                lease(command_kind="preflight"),
                {"expectedEmail": "buyer@example.com"},
                page,
                time.time() + 60,
            )

        self.assertEqual(navigations, ["https://chatgpt.com/"])
        self.assertIn(MOUNT_CUSTOM_CHECKOUT_JS, page.scripts)

    def test_classifies_plus_final_and_tier_specific_upgrade(self) -> None:
        fields = {
            "cardNumber": True,
            "expiry": True,
            "cvc": True,
            "billingName": True,
            "billingCountry": True,
            "billingPostal": True,
        }
        plus = {
            "origin": "https://pay.openai.com",
            "routeTemplate": "/pay/{id}",
            "plan": "plus",
            "country": "PH",
            "currency": "PHP",
            "displayedAmount": 1100,
            "fields": fields,
            "controls": {"submit": "payment-submit"},
        }
        self.assertEqual(_classify(plus, lease(), "checkout"), "PAYMENT_FINAL_READY")

        selection = {
            "origin": "https://chatgpt.com",
            "routeTemplate": "/settings/subscription",
            "plan": "prolite",
            "country": "PH",
            "currency": "PHP",
            "displayedAmount": 1100,
            "fields": {},
            "controls": {"upgradeX5": "upgrade-x5"},
        }
        self.assertEqual(
            _classify(selection, lease("upgrade", "x5"), "selection"),
            "UPGRADE_SELECTION_READY",
        )
        self.assertEqual(
            _classify(selection, lease("upgrade", "x20"), "selection"),
            "UNKNOWN_PAYMENT_STATE",
        )

    def test_classifies_card_entry_before_billing_fields_are_revealed(self) -> None:
        page = {
            "origin": "https://chatgpt.com",
            "routeTemplate": "/checkout/{id}",
            "plan": "plus",
            "country": "PH",
            "currency": "PHP",
            "displayedAmount": 1100,
            "fields": {"cardNumber": True, "expiry": True, "cvc": True, "billingCountry": True},
            "controls": {"submit": "hosted-payment-submit"},
        }
        self.assertEqual(
            _classify(page, lease(command_kind="preflight"), "checkout"),
            "PAYMENT_CARD_ENTRY_READY",
        )

    def test_price_facts_select_only_one_amount_inside_contract(self) -> None:
        facts = [{"displayedAmounts": [20, 1100, 9999], "displayedAmount": None}]
        self.assertEqual(_contract_amount(facts, lease()), 1100)
        facts[0]["displayedAmounts"] = [1050, 1100]
        self.assertIsNone(_contract_amount(facts, lease()))

    def test_card_entry_fill_does_not_require_billing_fields(self) -> None:
        class Frame:
            def evaluate(self, _script: str, fragment: dict[str, str]) -> dict[str, object]:
                self.fragment = fragment
                return {"accepted": True, "filled": ["cardNumber", "expiry", "cvc"]}

        class Page:
            frames = [Frame()]

        _fill_card_frames(Page(), {
            "card": {"Number": "4242424242424242", "ExpiryMonth": "08", "ExpiryYear": "2030", "CVV": "123"}
        })
        self.assertNotIn("billingName", Page.frames[0].fragment)

    def test_pre_route_cloudflare_handoff_keeps_only_challenge_control(self) -> None:
        page = _restrict_pre_route_challenge_controls({
            "origin": "https://chatgpt.com",
            "routeTemplate": "",
            "fields": {},
            "controls": {
                "challenge": "challenge-cloudflare",
                "submit": "hosted-payment-submit",
                "progression": "hosted-payment-next",
            },
        })
        self.assertEqual(page["controls"], {"challenge": "challenge-cloudflare"})

        checkout_page = _restrict_pre_route_challenge_controls({
            **page,
            "routeTemplate": "/checkout/{id}",
            "controls": {"challenge": "challenge-cloudflare", "submit": "hosted-payment-submit"},
        })
        self.assertEqual(checkout_page["controls"]["submit"], "hosted-payment-submit")

    def test_checkout_fact_diagnostic_contains_only_allowlisted_structure(self) -> None:
        diagnostic = _sanitized_fact_diagnostic({
            "stateId": "UNKNOWN_PAYMENT_STATE",
            "origin": "https://chatgpt.com",
            "routeTemplate": "/checkout/{id}",
            "plan": "plus",
            "country": "PH",
            "currency": "PHP",
            "displayedAmount": 1100,
            "rawText": "must not log",
            "fields": {"cardNumber": True, "pan": "must not log"},
            "controls": {"submit": "hosted-payment-submit", "raw": "must not log"},
        }, "https://chatgpt.com/checkout/openai_llc/oaics_secret_identifier")
        self.assertEqual(diagnostic["fields"], ["cardNumber"])
        self.assertEqual(diagnostic["controls"], {"submit": "hosted-payment-submit"})
        self.assertNotIn("rawText", diagnostic)
        self.assertEqual(diagnostic["pathClass"], "/checkout/{id}")
        self.assertNotIn("secret_identifier", json.dumps(diagnostic))

    def test_path_class_never_returns_checkout_identifiers(self) -> None:
        self.assertEqual(_path_class("https://chatgpt.com/"), "root")
        self.assertEqual(_path_class("https://chatgpt.com/auth/login"), "auth")
        self.assertEqual(_path_class("https://chatgpt.com/checkout/untrusted/value"), "checkout-unrecognized")

    def test_sustained_checkout_auth_redirect_fails_as_invalid_session(self) -> None:
        class Client:
            def heartbeat(self, _lease: ExecutorLease) -> None:
                pass

        class Page:
            url = "https://chatgpt.com/auth/login"

        with patch("python_executor.live._inspect", return_value={
            "stateId": "UNKNOWN_PAYMENT_STATE", "origin": "https://chatgpt.com", "routeTemplate": "",
            "fields": {}, "controls": {}, "structuralHash": "0" * 64,
        }), patch("python_executor.live.time.monotonic", side_effect=[1.0, 1.0, 1.0, 7.0, 7.0, 7.0, 7.0]), patch(
            "python_executor.live.time.time", return_value=1.0
        ), self.assertRaises(ExecutorAPIError) as raised:
            LiveExecutor()._wait_facts(Client(), lease(), Page(), 100.0, "checkout")
        self.assertEqual(raised.exception.code, "CHATGPT_SESSION_UNAUTHORIZED")

    def test_auth_redirect_cloudflare_marker_does_not_mask_invalid_session(self) -> None:
        class Client:
            def heartbeat(self, _lease: ExecutorLease) -> None:
                pass

        class Page:
            url = "https://chatgpt.com/auth/login?next=%2Fcheckout%2Fsafe"

        with patch("python_executor.live._inspect", return_value={
            "stateId": "PAYMENT_ACTION_REQUIRED", "origin": "https://chatgpt.com", "routeTemplate": "",
            "fields": {}, "controls": {"challenge": "challenge-cloudflare"}, "structuralHash": "0" * 64,
        }), patch("python_executor.live.time.monotonic", side_effect=[1.0, 1.0, 1.0, 1.0, 7.0, 7.0, 7.0]), patch(
            "python_executor.live.time.time", return_value=1.0
        ), patch("python_executor.live.time.sleep"), self.assertRaises(ExecutorAPIError) as raised:
            LiveExecutor()._wait_facts(Client(), lease(), Page(), 100.0, "checkout")
        self.assertEqual(raised.exception.code, "CHATGPT_SESSION_UNAUTHORIZED")

    def test_challenge_wait_stops_when_page_redirects_to_login(self) -> None:
        class Client:
            def heartbeat(self, _lease: ExecutorLease) -> None:
                pass

        class Page:
            url = "https://chatgpt.com/auth/login?next=%2Fcheckout%2Fsafe"

        with patch("python_executor.live._inspect", return_value={
            "stateId": "UNKNOWN_PAYMENT_STATE", "origin": "https://chatgpt.com", "routeTemplate": "",
            "fields": {}, "controls": {}, "structuralHash": "0" * 64,
        }), patch("python_executor.live.time.monotonic", side_effect=[1.0, 1.0, 1.0, 1.0, 7.0, 7.0, 7.0]), patch(
            "python_executor.live.time.time", side_effect=[1.0, 1.0, 101.0]
        ), patch("python_executor.live.time.sleep"), self.assertRaises(ExecutorAPIError) as raised:
            LiveExecutor()._wait_challenge_clear(Client(), lease(), Page(), 100.0, "checkout")
        self.assertEqual(raised.exception.code, "CHATGPT_SESSION_UNAUTHORIZED")

    def test_action_click_is_between_activate_and_result(self) -> None:
        calls: list[str] = []

        class Client:
            def prepare_action(self, *_args: object) -> dict[str, str]:
                calls.append("prepare")
                return {"permitId": "permit-1"}

            def activate_action(self, *_args: object) -> dict[str, bool]:
                calls.append("activate")
                return {"activated": True}

            def action_result(self, *_args: object) -> dict[str, bool]:
                calls.append("result")
                return {"continue": True}

        class Locator:
            def count(self) -> int:
                return 1

            def is_visible(self) -> bool:
                return True

            def is_enabled(self) -> bool:
                return True

            def click(self, timeout: int) -> None:
                self.assert_timeout = timeout
                calls.append("click")

        class Frame:
            url = "https://pay.openai.com/pay/test"

            def locator(self, _selector: str) -> Locator:
                return Locator()

        class Page:
            frames = [Frame()]

        result = LiveExecutor()._activate(
            Client(), lease(), Page(), {"stateId": "PAYMENT_FINAL_READY"}, "submit", "payment-submit"
        )
        self.assertTrue(result["continue"])
        self.assertEqual(calls, ["prepare", "activate", "click", "result"])


if __name__ == "__main__":
    unittest.main()
