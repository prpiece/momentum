import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { attachmentRefs } from "@core/domain/attachments";
import { noteImageUrl } from "@core/lib/sync/attachments";
import { useColors } from "@/theme";
import { Icon, Text } from "./kit";

/**
 * A note's images (D291), read from the server with one-hour signed URLs; expo-image keeps them on
 * disk by file name. Signed out, offline, or not uploaded yet: a muted "unavailable" line.
 */
export function NoteImages({ description }: { description: string }) {
  const c = useColors();
  const names = useMemo(() => [...attachmentRefs([description])], [description]);
  // undefined: still asking; null: unavailable.
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    for (const n of names)
      void noteImageUrl(n)
        .catch(() => null)
        .then((u) => live && setUrls((p) => ({ ...p, [n]: u })));
    return () => {
      live = false;
    };
  }, [names]);
  return names.map((n) => {
    const url = urls[n];
    if (url) return <Image key={n} source={{ uri: url, cacheKey: n }} contentFit="contain" style={s.img} accessibilityLabel="Image" />;
    return (
      <View key={n} style={s.chip}>
        <Icon name="image" size={16} color={c.muted} />
        <Text variant="meta" style={{ color: c.muted }}>
          {url === undefined ? "Loading image…" : "Image unavailable"}
        </Text>
      </View>
    );
  });
}

const s = StyleSheet.create({
  img: { width: "100%", height: 220, marginTop: 8, borderRadius: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
});
