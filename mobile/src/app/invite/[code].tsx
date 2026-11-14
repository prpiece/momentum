import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSync } from "@core/lib/sync/engine";
import { useColors } from "@/theme";
import { openLink } from "@/social/actions";

/** `momentum://invite/<code>`: applies the invite (or keeps it until sign-in, D261), then shows Friends. */
export default function Invite() {
  const c = useColors();
  const { code } = useLocalSearchParams<{ code: string }>();
  useEffect(() => {
    void openLink(code).finally(() => router.replace(useSync.getState().account ? "/friends" : "/account"));
  }, [code]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}
