/*
 * Settings → Connections' calls to the `calendar` function (FEAT-01, D345). The function holds the
 * Google and Microsoft grants; the app only asks it to connect, list, choose, sync and disconnect.
 */
import type { CalProvider } from "../../domain/types";
import { setCalendarLinked, syncCalendars } from "./engine";
import { supabase } from "./supabase";

export type LinkedCalendar = { id: string; name: string; color: string | null; primary: boolean; canEdit: boolean; sync: boolean };
export type CalendarAccount = { provider: CalProvider; email: string | null; calendars: LinkedCalendar[]; writeCalendarId: string | null; lastSync: string | null; error: string | null };

async function call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`calendar/${path}`, { method, ...(body !== undefined ? { body } : {}) });
  if (error) throw error;
  return data as T;
}

/** The connected accounts, their calendar lists fresh from the provider. */
export async function calendarAccounts(): Promise<CalendarAccount[]> {
  const { accounts } = await call<{ accounts: CalendarAccount[] }>("list", "GET");
  setCalendarLinked(accounts.some((a) => a.writeCalendarId));
  return accounts;
}

/** The link that starts a connection, to open in the system browser (valid for two minutes). */
export const connectUrl = async (p: CalProvider) => (await call<{ url: string }>(`connect/${p}`, "POST", {})).url;

export const chooseCalendars = (p: CalProvider, sync: string[], write: string | null) => call(`calendars/${p}`, "POST", { sync, write });

/** `keep` turns the account's events into Momentum-only events instead of removing them. */
export const disconnectCalendar = (p: CalProvider, keep: boolean) => call(`disconnect/${p}`, "POST", { keep });

export { syncCalendars };
