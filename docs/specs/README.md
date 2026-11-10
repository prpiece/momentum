# Specs

One spec per release, built from the decisions in `PLAN.md` (D104–D184) and the ADRs in `docs/adr/`.

| Release | Spec | Depends on |
|---|---|---|
| v1.0.0 | [Simplify and redesign](v1.0-simplify-redesign.md) | nothing; offline only |
| v1.1 | [Accounts and sync](v1.1-accounts-sync.md), [launch checklist](v1.1-launch-checklist.md) | v1.0 (migration 0008, settings split) |
| v1.2 | [iOS and Android](v1.2-mobile.md) | v1.1 (plus v1.1.1 fixes) |
| — | Repo goes private, after the updater and Pages move to a public host (D224) | v1.2 |
| v1.3 | [Friends and leaderboards](v1.2-friends-leaderboards.md) (file keeps its old number) | v1.1 |
| v1.4 | [Sharing](v1.3-sharing.md) (file keeps its old number) | v1.1, v1.3 |

Open items:
- Which `usemomentum` domain to buy (D192). `.co`, `.org` and `.net` looked free on 2026-11-07; `.app`, `.com` and `.io` were taken.
- A USPTO/EUIPO trademark check on "Momentum" for software before v1.2's public launch (D192).
- Paddle or Lemon Squeezy (D190), chosen when payments are built, after v1.2.
- Apple developer enrolment for Sign in with Apple.
- AI features (D143–D144, D179).

Settled: the name stays Momentum (D192). Terms and Privacy and, until the domain exists, invite links live on GitHub Pages (D186, D189).
