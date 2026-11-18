// The `storage-purge` Edge Function (account deletion); the work is in app.ts so tests can run it.
import { handle } from "./app.ts";

Deno.serve((req) => handle(req, Deno.env.toObject()));
