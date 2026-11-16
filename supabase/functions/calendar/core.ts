/*
 * The shared domain code the calendar function runs (D345): provider mapping, push and conflict rules,
 * and the apps' own row mapping. `node scripts/bundle-inbound.mjs` bundles this file into
 * core.bundle.js for Deno; a test fails if the bundle is stale or pulls in anything impure.
 */
export { fromGoogle, fromGraph, googleInstanceKey, pushAction, remoteChanged, toGoogle, toGraph, toRowFields } from "../../../src/domain/calendarSync";
export type { Change, LinkedAccount, Mapped, PushAction } from "../../../src/domain/calendarSync";
export { eventToRow, parseEvent } from "../../../src/db/rows";
export { isZone } from "../../../src/domain/dates";
export type { CalendarEvent, CalProvider } from "../../../src/domain/types";
