# Reuse order-issued CDKs across delivery retries

KaWang will create one durable store fulfillment task for each Dujiao delivery target and retain the exact order-issued CDKs assigned to that task. A timeout or failed delivery attempt retries the same CDKs rather than issuing replacements, and the task completes only after remote delivery is confirmed; this prevents duplicate live cards when the result of a cross-system request is uncertain.
