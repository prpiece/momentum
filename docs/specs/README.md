# Specs

One spec per release, built from the decisions in `PLAN.md` and the ADRs in `docs/adr/`. The plan after v1.1.3 was reset on 2026-11-14 (D256–D269).

| Release | Spec | Track | Depends on |
|---|---|---|---|
| v1.0.0 | [Simplify and redesign](v1.0-simplify-redesign.md) | — | nothing; offline only |
| v1.1 | [Accounts and sync](v1.1-accounts-sync.md), [launch checklist](v1.1-launch-checklist.md) | — | v1.0 |
| v1.2 | [Phone app (Expo)](v1.2-mobile.md), [tickets](v1.2-mobile-tickets.md), [remove gamification, one version, phone ready](v1.2-degamify-release.md), [store updates checklist](v1.2-store-updates-checklist.md) | A | v1.1.3 |
| v1.3 | [Connectors and planning](v1.3-connectors-planning.md) | B | v1.2 |
| v1.4 | [Friends, shares and connections](v1.4-social-connections.md) | C | v1.1 sync; merges after v1.3 |
| v1.5 | [Pro plan](v1.5-pro.md) | — | v1.4 |
| v1.2.4 | [Test findings](v1.2.4-test-findings/README.md) (244 entries from a full test pass) | — | v1.2.3 |
| — | Repo moves to the other GitHub account and goes private (D269) | — | after the app work |

## Building fast (D258)

Tracks A, B and C start together, each in its own git worktree and branch, and work through small tickets with subagents. They merge and release in order: A, then B, then C.

The ownership rules let them run in parallel without overwriting each other:

| Area | Owner |
|---|---|
| Deleting gamification, `mobile/` polish, version fields | A |
| The `Task` type, quick-add tokens, local SQLite migrations, `src/domain/` planning logic, CLI/MCP, calendar subscriptions, import | B |
| Supabase migrations, Edge Functions, RLS, Settings → Connections, friends, shares, bots | C |

Where tracks meet:
- **B to C:** B lists the server columns its new fields need. C adds them in its first migration.
- **B to C:** B ships its Settings panels as standalone components, and C mounts them in Connections.
- **C after B:** C adds `assignee_id` to `Task` only after B has merged.
- **A first:** A deletes `perfect.ts` and the celebration code. B and C rebase onto A once it merges, so neither builds on code that's going away.

Each track ends with its spec's Verification list run against the real app, then a release with the shared version (D257).

## Open items

- **Domain:** which `usemomentum` domain to buy (D192), bought before launch (D259). `.co`, `.org` and `.net` were free on 2026-11-07.
- **Trademark:** a USPTO/EUIPO check on "Momentum" for software before the public launch (D192).
- **Sign in with Apple:** Apple developer enrolment.
- **Outlook:** two-way Outlook sync once Microsoft's outage is over (D263).
