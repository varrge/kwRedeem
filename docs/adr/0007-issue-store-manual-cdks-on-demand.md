# Issue store manual-processing CDKs on demand

When a mapped Dujiao fulfillment target enters `fulfilling`, KaWang will create new manual-processing CDKs for the purchased quantity and bind them to that store fulfillment task instead of consuming pre-created active inventory. Manual-processing CDKs have no upstream source-key scarcity, and on-demand issuance provides a unique, auditable assignment without reserving cards that must remain active for the buyer to redeem later.
