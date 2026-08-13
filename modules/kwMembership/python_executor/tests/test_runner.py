from __future__ import annotations

import unittest
from unittest import mock

from python_executor.client import ExecutorAPIError, ExecutorLease
from python_executor.runner import PreflightExecutor, executor_for_mode


def lease(command_kind: str) -> ExecutorLease:
    return ExecutorLease(
        execution_id="exec-preflight",
        executor_id="python-test",
        lease_epoch=1,
        lease_token="opaque",
        hard_deadline_at="2026-08-14T00:05:00Z",
        command_kind=command_kind,
        stage="plus",
        attempt_no=1,
        target_tier="plus",
        adapter_version="python-session-card-checkout-v1",
        price_contract={"MinAmount": 960, "MaxAmount": 982.34},
    )


class PreflightExecutorTest(unittest.TestCase):
    def test_rejects_payment_before_starting_live_browser(self) -> None:
        with mock.patch("python_executor.runner.LiveExecutor") as live:
            with self.assertRaises(ExecutorAPIError) as raised:
                PreflightExecutor().execute(mock.Mock(), lease("payment"))
        self.assertEqual(raised.exception.code, "PREFLIGHT_PAYMENT_DISABLED")
        live.assert_not_called()

    def test_delegates_preflight_to_live_browser(self) -> None:
        with mock.patch("python_executor.runner.LiveExecutor") as live:
            PreflightExecutor().execute(mock.Mock(), lease("preflight"))
        live.return_value.execute.assert_called_once()

    def test_mode_selects_preflight_executor(self) -> None:
        self.assertIsInstance(executor_for_mode("preflight"), PreflightExecutor)


if __name__ == "__main__":
    unittest.main()
