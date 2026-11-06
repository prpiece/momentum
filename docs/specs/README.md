# Specs

One spec per release, built from the decisions in `PLAN.md` (D104–D184) and the ADRs in `docs/adr/`.

| Release | Spec | Depends on |
|---|---|---|
| v1.0.0 | [Simplify and redesign](v1.0-simplify-redesign.md) | nothing; offline only |
| v1.1 | [Accounts and sync](v1.1-accounts-sync.md) | v1.0 (migration 0008, settings split) |
| v1.2 | [Friends and leaderboards](v1.2-friends-leaderboards.md) | v1.1 |
| v1.3 | [Sharing](v1.3-sharing.md) | v1.1, v1.2 |

Open items:
- The product name and the `get<name>.app/.com` domain (D185, D188), chosen during the v1.0 build. The new identifier and the one-time data copy from `com.momentum.planner` ship in v1.0.
- Paddle or Lemon Squeezy (D190), chosen when payments are built, after v1.2.
- Apple developer enrolment for Sign in with Apple.
- AI features (D143–D144, D179).

Settled: Terms and Privacy and, until the domain exists, invite links live on GitHub Pages (D186, D189).
