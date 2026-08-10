# Keep real API keys out of tutorial pages

Status: accepted.

The Tutorial Center remains a Credential-Safe Tutorial: public and embedded pages use placeholders and link users to the authenticated Sub2api console for key creation and management, but never read, store, render, or auto-fill a real API Key. This gives up one-click setup in exchange for keeping secrets outside iframe content, browser history, tutorial analytics, and third-party client recipes; users paste a key only into the client they choose and can return to the console to revoke or rotate it.
