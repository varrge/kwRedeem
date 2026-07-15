# Project Rules

## Sub2api Boundary

- Do not modify files under `sub2api/` unless the user explicitly asks for changes to the local reference checkout.
- Treat `sub2api/` as the official upstream/reference project only. Pull or inspect it to understand the official API shape, then implement integration logic in this project.
- `sub.vsakura.top` is the remote official Sub2api server.
- `apikey.vsakura.top` is this project's API service. It stores and uses the remote Sub2api admin key.
- Sub2api invite-code creation must go through this project's API service with the stored admin key, then call the remote official Sub2api admin endpoint.
- Do not implement invite-code creation through a user token or `/api/v1/user/aff` unless the user explicitly changes the architecture.
- Official Sub2api admin redeem-code generation may return invite codes as `code` inside `data` or nested response wrappers. Integration code must parse the official response shape instead of requiring only `inviteCode`.

## World Cup Integration

- The World Cup guessing system should be embedded into this project, not into the local `sub2api/` checkout.
- Balance deduction for guesses should happen in this project's API/business layer against the remote Sub2api account through the configured admin-key integration path.
- When diagnosing balance or invite failures, first verify the deployed `apikey.vsakura.top` behavior and logs; local edits do not affect the remote service until deployed/restarted.
- World Cup match lists should support filtering and a scrollable list UI.
