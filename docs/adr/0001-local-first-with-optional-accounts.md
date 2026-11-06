# Local-first stays; accounts are optional

Momentum goes online for sync, list sharing and social features, but the app keeps working fully without an account: local SQLite stays the source of truth on each device and signing in adds sync on top. This replaces the "no network calls except the update check" rule (D59, D81): the network is now used for the update check, the voice model download, and sync/social when signed in. A server-first, account-required app was rejected because it would break existing users' offline use and their data on upgrade.

## Consequences

- The first sign-in on a device that already has data has to merge that data into the account.
- Every synced table needs stable UUIDs, `updated_at` and soft deletes (tombstones). That means the fixed `inbox` id, unique tag names, autoincrement activity ids and hard `DELETE`s all have to change.
- "See tasks online" means cloud sync between installed apps. A web client is deferred until after mobile.
