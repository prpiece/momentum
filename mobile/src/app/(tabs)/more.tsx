import { router } from "expo-router";
import { ScrollView, Text } from "react-native";
import { useSync } from "@core/lib/sync/engine";
import { statusText } from "@core/lib/sync/account";
import { useColors } from "@/theme";
import { NavRow } from "@/ui/kit";

/** Everything that isn't a tab: Focus, Search, Settings, Account. */
export default function More() {
  const c = useColors();
  const account = useSync((s) => s.account);
  const status = useSync((s) => s.status);
  return (
    <ScrollView>
      <NavRow icon="clock" title="Focus" onPress={() => router.push("/focus")} />
      <NavRow icon="search" title="Search" onPress={() => router.push("/search")} />
      <NavRow icon="settings" title="Settings" onPress={() => router.push("/settings")} />
      <NavRow icon="gift" title="What's new" onPress={() => router.push("/whats-new")} />
      <NavRow icon="user" title="Account" detail={account ? undefined : "Sign in"} onPress={() => router.push("/account")} />
      {account ? <Text style={{ color: c.muted, padding: 16 }}>{statusText(status)}</Text> : null}
    </ScrollView>
  );
}
