import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { calendarItems, coversDay, dayRange, droppedSchedule, itemsOnDay, layoutDay, minutesInDay, rangeTitle, resizedSchedule, stepAnchor, viewDays, type CalItem } from "@core/domain/calendar";
import { addDaysLocal, formatTime, fromLocalDate, relativeDayLabel, todayLocal } from "@core/domain/dates";
import { derive } from "@core/domain/taskViews";
import type { LocalDate, Task, WeekStart } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { applySchedule, currentSchedule } from "@core/stores/schedule";
import { useSettings } from "@core/stores/settings";
import { resolveColor, useColors, type Colors } from "@/theme";
import { Empty, IconButton, Segmented, Text } from "@/ui/kit";
import { useQuickAddContext } from "@/ui/QuickAdd";

type View_ = "day" | "3day" | "month" | "agenda";
const VIEWS = [
  { value: "agenda", label: "Agenda" },
  { value: "3day", label: "3 days" },
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
] as const;
const HOUR = 56;
const PPM = HOUR / 60;
const GUTTER = 44;

const daysOf = (view: View_, anchor: LocalDate, weekStart: WeekStart): LocalDate[] => (view === "3day" ? dayRange(anchor, 3) : viewDays(view, anchor, weekStart));
const step = (view: View_, anchor: LocalDate, dir: 1 | -1) => (view === "3day" ? addDaysLocal(anchor, 3 * dir) : stepAnchor(view, anchor, dir));

const openItem = (i: CalItem) => {
  if (i.source === "task") router.push({ pathname: "/task/[id]", params: { id: i.id, key: i.key ?? "" } });
  else if (i.source === "event") router.push({ pathname: "/event/[id]", params: { id: i.id, key: i.key ?? "" } });
};
const newAt = (day: LocalDate, minute: number | null) => router.push({ pathname: "/event/[id]", params: { id: "new", day, minute: minute === null ? "" : String(minute) } });

export default function Calendar() {
  const c = useColors();
  const today = todayLocal();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>("agenda");
  const [anchor, setAnchor] = useState(today);
  // Month: the day whose agenda shows under the grid.
  const [picked, setPicked] = useState(today);
  useQuickAddContext({ schedule: { kind: "day", date: view === "month" ? picked : anchor } });
  const weekStart = useSettings((s) => s.settings.weekStart);
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const events = useData((s) => s.events);
  const days = useMemo(() => daysOf(view, anchor, weekStart), [view, anchor, weekStart]);
  const items = useMemo(() => {
    const colorOf = (t: Task) => lists[t.listId]?.color ?? "var(--accent)";
    return calendarItems({ tasks: derive(tasks, lists).active, events: Object.values(events), colorOf, showCompleted: true }, days[0], days[days.length - 1]);
  }, [tasks, lists, events, days]);

  const title =
    view === "3day"
      ? rangeTitle("5day", days, anchor)
      : view === "day"
        ? fromLocalDate(anchor).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
        : rangeTitle(view, days, anchor);
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 4 }}>
      <View style={s.bar}>
        <View style={s.nav}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </Text>
          <IconButton icon="chevron-left" label="Previous" color={c.fg} onPress={() => setAnchor(step(view, anchor, -1))} />
          <Pressable onPress={() => (setAnchor(today), setPicked(today))} accessibilityRole="button" style={s.navButton}>
            <Text style={{ color: c.accentText, fontWeight: "600", fontSize: 15 }}>Today</Text>
          </Pressable>
          <IconButton icon="chevron-right" label="Next" color={c.fg} onPress={() => setAnchor(step(view, anchor, 1))} />
        </View>
        <Segmented value={view} options={VIEWS} onChange={setView} />
      </View>
      {view === "month" ? (
        <Month days={days} anchor={anchor} items={items} c={c} picked={picked} onDay={setPicked} />
      ) : view === "agenda" ? (
        <Agenda days={days} items={items} c={c} />
      ) : (
        <Grid days={days} items={items} c={c} />
      )}
    </View>
  );
}

/** Day / 3-day time grid: all-day row, hour lines, blocks placed by the shared layoutDay. */
function Grid({ days, items, c }: { days: LocalDate[]; items: CalItem[]; c: Colors }) {
  const { width } = useWindowDimensions();
  const colW = (width - GUTTER) / days.length;
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const today = todayLocal();
  useEffect(() => {
    // Open at the current hour (or 8:00), not midnight.
    const h = days.includes(today) ? Math.max(0, new Date().getHours() - 1) : 8;
    setTimeout(() => scroll.current?.scrollTo({ y: h * HOUR, animated: false }), 0);
  }, [days, today]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.dayHeads, { borderColor: c.border }]}>
        <View style={{ width: GUTTER }} />
        {days.map((d) => (
          <View key={d} style={{ width: colW, paddingVertical: 4 }}>
            <Text style={{ textAlign: "center", color: d === today ? c.accentText : c.fg2, fontWeight: d === today ? "700" : "500" }}>{relativeDayLabel(d, today)}</Text>
            {items
              .filter((i) => i.allDay && coversDay(i, d))
              .map((i) => (
                <Pressable key={i.uid} onPress={() => openItem(i)} style={[s.allDay, { backgroundColor: resolveColor(c, i.color) }]}>
                  <Text numberOfLines={1} style={{ color: "#FFFFFF", fontSize: 12, textDecorationLine: i.done ? "line-through" : "none" }}>
                    {i.title}
                  </Text>
                </Pressable>
              ))}
          </View>
        ))}
      </View>
      <ScrollView ref={scroll}>
        <View style={{ height: 24 * HOUR, flexDirection: "row" }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Text key={h} style={[s.hour, { top: h * HOUR - 7, color: c.muted }]}>
                {h ? formatTime(new Date(2026, 0, 1, h), timeFormat).replace(":00", "") : ""}
              </Text>
            ))}
          </View>
          {days.map((d) => (
            <Column key={d} day={d} width={colW} colIndex={days.indexOf(d)} days={days} items={itemsOnDay(items, d).filter((i) => !i.allDay)} c={c} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Column({ day, width, days, colIndex, items, c }: { day: LocalDate; width: number; days: LocalDate[]; colIndex: number; items: CalItem[]; c: Colors }) {
  const placed = useMemo(() => layoutDay(items, day), [items, day]);
  const nowMin = day === todayLocal() ? minutesInDay(new Date(), day) : null;
  // Tap on empty space creates an item at that time (snapped by the event screen).
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const minute = e.y / PPM;
      // A tap on a block opens it (its own gesture); only empty space creates.
      if (placed.some((p) => minute >= p.top && minute <= Math.max(p.bottom, p.top + 20))) return;
      newAt(day, Math.floor(minute / 15) * 15);
    });
  return (
    <GestureDetector gesture={tap}>
      <View style={{ width, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
        {Array.from({ length: 24 }, (_, h) => (
          <View key={h} style={[s.line, { top: h * HOUR, borderColor: c.border }]} />
        ))}
        {nowMin !== null ? <View style={[s.now, { top: nowMin * PPM, backgroundColor: c.danger }]} /> : null}
        {placed.map((p) => (
          <Block key={p.item.uid} item={p.item} top={p.top * PPM} height={Math.max(20, (p.bottom - p.top) * PPM)} left={(p.col / p.cols) * width} width={width / p.cols} day={day} days={days} colIndex={colIndex} colW={width} c={c} />
        ))}
      </View>
    </GestureDetector>
  );
}

/** A timed block: tap opens it; press and hold, then drag to move (across days too); drag the bottom edge to resize. */
function Block({ item, top, height, left, width, day, days, colIndex, colW, c }: { item: CalItem; top: number; height: number; left: number; width: number; day: LocalDate; days: LocalDate[]; colIndex: number; colW: number; c: Colors }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; dh: number } | null>(null);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const editable = !item.readOnly && (item.source === "task" || item.source === "event");
  const ref = { source: item.source, id: item.id, key: item.key };

  const move = Gesture.Pan()
    .runOnJS(true)
    .enabled(editable)
    .activateAfterLongPress(350)
    .onUpdate((e) => setDrag({ dx: e.translationX, dy: e.translationY, dh: 0 }))
    .onEnd((e) => {
      setDrag(null);
      const target = days[Math.min(days.length - 1, Math.max(0, colIndex + Math.round(e.translationX / colW)))];
      const startMinute = top / PPM + e.translationY / PPM;
      void applySchedule(ref, droppedSchedule(currentSchedule(ref), target, "time", startMinute));
    })
    .onFinalize(() => setDrag(null));
  const open = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => openItem(item));
  const resize = Gesture.Pan()
    .runOnJS(true)
    .enabled(editable)
    .onUpdate((e) => setDrag({ dx: 0, dy: 0, dh: e.translationY }))
    .onEnd((e) => {
      setDrag(null);
      void applySchedule(ref, resizedSchedule(currentSchedule(ref), "end", (top + height + e.translationY) / PPM, day));
    })
    .onFinalize(() => setDrag(null));

  const color = resolveColor(c, item.color);
  return (
    <GestureDetector gesture={Gesture.Exclusive(move, open)}>
      <View
        style={[
          s.block,
          { top: top + (drag?.dy ?? 0), height: Math.max(20, height + (drag?.dh ?? 0)), left: left + (drag?.dx ?? 0) + 1, width: width - 2, backgroundColor: color, opacity: item.done ? 0.55 : drag ? 0.85 : 1, zIndex: drag ? 10 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${item.start ? `, ${formatTime(item.start, timeFormat)}` : ""}`}
      >
        <Text numberOfLines={Math.max(1, Math.floor(height / 16))} style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600", textDecorationLine: item.done ? "line-through" : "none" }}>
          {item.title}
        </Text>
        {editable && height >= 32 ? (
          <GestureDetector gesture={resize}>
            <View style={s.handle} accessibilityLabel="Resize" />
          </GestureDetector>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function Month({ days, anchor, items, c, picked, onDay }: { days: LocalDate[]; anchor: LocalDate; items: CalItem[]; c: Colors; picked: LocalDate; onDay: (d: LocalDate) => void }) {
  const month = anchor.slice(0, 7);
  const today = todayLocal();
  return (
    <ScrollView>
      <View style={s.weekdays}>
        {days.slice(0, 7).map((d) => (
          <Text key={d} style={{ flex: 1, textAlign: "center", color: c.muted, fontSize: 12, fontWeight: "600" }}>
            {fromLocalDate(d).toLocaleDateString(undefined, { weekday: "narrow" })}
          </Text>
        ))}
      </View>
      <View style={s.month}>
        {days.map((d) => {
          const on = items.filter((i) => coversDay(i, d));
          const sel = d === picked;
          return (
            <Pressable key={d} onPress={() => onDay(d)} onLongPress={() => newAt(d, null)} style={s.cell} accessibilityRole="button" accessibilityState={{ selected: sel }} accessibilityLabel={`${relativeDayLabel(d, today)}, ${on.length} items`}>
              <View style={[s.dayNum, sel && { backgroundColor: d === today ? c.accent : c.fg }]}>
                <Text style={{ color: sel ? (d === today ? c.accentFg : c.surface) : d === today ? c.accentText : d.startsWith(month) ? c.fg : c.muted, fontWeight: d === today || sel ? "600" : "400", fontSize: 15, fontVariant: ["tabular-nums"] }}>{fromLocalDate(d).getDate()}</Text>
              </View>
              <View style={s.dots}>
                {on.slice(0, 3).map((i) => (
                  <View key={i.uid} style={[s.dot6, { backgroundColor: resolveColor(c, i.color) }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
        <Agenda days={[picked]} items={items} c={c} plain />
      </View>
    </ScrollView>
  );
}

function Agenda({ days, items, c, plain }: { days: LocalDate[]; items: CalItem[]; c: Colors; plain?: boolean }) {
  const today = todayLocal();
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const withItems = days.map((d) => ({ d, on: itemsOnDay(items, d) })).filter((x) => x.on.length);
  return (
    <Wrap plain={plain}>
      {withItems.length ? null : <Empty text="Nothing scheduled" hint="Tap + to add something for this day." />}
      {withItems.map(({ d, on }) => (
        <View key={d}>
          <Text variant="label" style={[s.agendaDay, { color: d === today ? c.accentText : c.muted }]}>{d === today ? `Today · ${fromLocalDate(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : relativeDayLabel(d, today)}</Text>
          {on.map((i) => (
            <Pressable key={i.uid} onPress={() => openItem(i)} style={[s.agendaRow, { borderColor: c.border }]}>
              <View style={[s.dot, { backgroundColor: resolveColor(c, i.color) }]} />
              <Text variant="bodyStrong" style={{ color: i.done ? c.muted : c.fg, flex: 1, textDecorationLine: i.done ? "line-through" : "none" }} numberOfLines={2}>
                {i.title}
              </Text>
              <Text style={{ color: c.muted, fontSize: 14, fontVariant: ["tabular-nums"] }}>{i.allDay ? "All day" : i.start ? formatTime(i.start, timeFormat) : ""}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </Wrap>
  );
}

const Wrap = ({ plain, children }: { plain?: boolean; children: ReactNode }) => (plain ? <View>{children}</View> : <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>{children}</ScrollView>);

const s = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  nav: { flexDirection: "row", alignItems: "center", gap: 4 },
  navButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  navTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  dayHeads: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  allDay: { marginHorizontal: 2, marginTop: 2, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  hour: { position: "absolute", right: 6, fontSize: 11 },
  line: { position: "absolute", left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  now: { position: "absolute", left: 0, right: 0, height: 2 },
  block: { position: "absolute", borderRadius: 4, paddingHorizontal: 4, paddingTop: 2, overflow: "hidden" },
  handle: { position: "absolute", left: 0, right: 0, bottom: 0, height: 14 },
  weekdays: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 4 },
  month: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, paddingBottom: 8 },
  cell: { width: `${100 / 7}%`, minHeight: 52, alignItems: "center", paddingTop: 4, gap: 3 },
  dayNum: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 3, height: 6 },
  dot6: { width: 6, height: 6, borderRadius: 3 },
  agendaDay: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  agendaRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
