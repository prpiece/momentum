/*
 * The shared domain code the inbound function runs (ADR 0008): the same quick-add parser, row
 * mapping and smart-list rules as the apps. `node scripts/bundle-inbound.mjs` bundles this file
 * into core.bundle.js for Deno; a test fails if the bundle is stale or pulls in anything impure.
 */
export { parseQuickAdd } from "../../../src/domain/quickAdd";
export { bestName } from "../../../src/domain/fuzzy";
export { parseTask, taskToRow } from "../../../src/db/rows";
export { toVM, inSmartList, isOverdue, matchScore } from "../../../src/domain/taskViews";
export { addDaysLocal, toLocalDate, moveToDate } from "../../../src/domain/dates";
export { detachOccurrence, effective } from "../../../src/domain/recurrence";
export { INBOX_ID } from "../../../src/domain/types";
export type { Task, Schedule, LocalDate } from "../../../src/domain/types";
