// The `inbound` Edge Function (ADR 0008); the work is in app.ts so the server tests can run it.
import { handle } from "./app.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve((req) => handle(req, Deno.env.toObject(), { waitUntil: (p) => EdgeRuntime?.waitUntil(p) }));
