# Wrap SpaceX CDKs for store fulfillment

Status: accepted

For an explicitly mapped `spacex_cdk` product, KaWang will fulfill each purchased unit with a buyer-visible KaWang SpaceX Activation CDK backed one-to-one by an encrypted upstream SpaceX CDK. Fulfillment allocates verified reusable inventory for the same plan before issuing a new upstream code; new issuance is unit-scoped and idempotent, and Dujiao receives the complete wrapper set only after every binding is durable. An uncertain issuance blocks delivery for operator reconciliation instead of buying replacements. Historical manual-processing mappings and tasks retain their original contract.

The buyer never receives the upstream code. KaWang accepts the wrapper and an ephemeral ChatGPT Session, proxies SpaceX preview, preflight, redeem, and result synchronization, and binds the wrapper to the verified account after preflight. Webhooks are the primary result path with scheduled reconciliation as repair. Unredeemed SpaceX funding caps count as committed liabilities, so issuance requires an authoritative cap snapshot and sufficient uncommitted owner balance. This HTTP CDK flow belongs to KaWang and does not reactivate the retired Go browser-payment automation.
