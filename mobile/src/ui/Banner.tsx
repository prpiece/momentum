import { Pressable, StyleSheet, View } from "react-native";
import { syncNow, useSync } from "@core/lib/sync/engine";
import { GUTTER, useColors } from "@/theme";
import { Icon, Text } from "./kit";

/**
 * Sync stays silent until it matters (02 §3): a quiet line when offline, a danger-soft banner
 * with Retry on an error, and a banner when the server needs a newer app.
 */
export function SyncBanner() {
  const c = useColors();
  const status = useSync((s) => s.status);
  const account = useSync((s) => s.account);
  if (!account) return null;
  if (status.kind === "offline")
    return (
      <View style={s.line} accessibilityLiveRegion="polite">
        <Icon name="wifi-off" size={14} color={c.muted} />
        <Text variant="meta" style={{ color: c.muted }}>
          Offline · changes will sync when you're back
        </Text>
      </View>
    );
  if (status.kind !== "error" && status.kind !== "updateRequired") return null;
  const error = status.kind === "error";
  return (
    <View style={[s.banner, { backgroundColor: c.dangerSoft }]} accessibilityRole="alert">
      <Icon name="alert-circle" size={18} color={c.danger} />
      <Text variant="meta" style={{ flex: 1, color: c.fg }}>
        {error ? "Couldn't sync. Your changes are safe on this phone." : "Update Momentum to keep syncing. Everything still works on this phone."}
      </Text>
      {error ? (
        <Pressable onPress={() => void syncNow()} accessibilityRole="button" style={s.retry}>
          <Text style={{ color: c.fg, fontWeight: "600", fontSize: 14 }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: GUTTER, paddingTop: 8 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12, paddingLeft: 12, borderRadius: 10, minHeight: 48 },
  retry: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center" },
});
