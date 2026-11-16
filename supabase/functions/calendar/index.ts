// The `calendar` Edge Function (FEAT-01, PLAN D345); the work is in app.ts so tests can run it.
import { handle } from "./app.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve((req) => handle(req, Deno.env.toObject(), { waitUntil: (p) => EdgeRuntime?.waitUntil(p) }));
