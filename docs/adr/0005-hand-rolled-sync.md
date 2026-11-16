# Sync is hand-rolled: field patches ordered by the server

Clients keep a queue of field-level patches (only the fields that changed), push them to Supabase, and pull every change since their last server cursor. The server applies patches in the order they arrive and stamps versions; device clocks never decide which edit wins. So two people editing different fields of the same task both keep their edits, and only a true same-field clash loses one. Exceptions: count-goal habit check-ins are summed increments, and detached occurrences have deterministic ids. We rejected PowerSync and ElectricSQL (no client for Tauri's SQLite plugin, plus extra infrastructure) and CRDTs (far more machinery than a planner's conflicts need). Correctness rests on the multi-client simulation test (D162), not on the library.

## Amended by D342 (2026-11-16)

Same-field conflicts are no longer decided by arrival order. The server keeps a per-field edit time and drops a patch's field when its stored stamp is newer, so the last edit wins. Device clocks are used only for that stamp, clamped to server time plus 5 minutes, so a clock set far ahead cannot win for good. Patches from apps that send no time (v1.2.3 and older) still apply and are stamped with server time.
