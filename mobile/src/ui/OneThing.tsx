import { View } from "react-native";
import { addDaysLocal, formatMinutes, moveToDate, relativeDayLabel, taskMinutes, todayLocal } from "@core/domain/dates";
import { pickOneThing } from "@core/domain/oneThing";
import { scheduleForKey } from "@core/domain/recurrence";
import type { TaskVM } from "@core/domain/taskViews";
import type { Energy } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { useSettings } from "@core/stores/settings";
import { editTask, toggleDone } from "@core/stores/taskActions";
import { useColors } from "@/theme";
import { Button, Card, Segmented, Text } from "@/ui/kit";
import { openTaskDetails } from "@/ui/TaskRow";

const ENERGY: { value: Energy; label: string }[] = [
  { value: "normal", label: "Normal energy" },
  { value: "low", label: "Low energy" },
];

/** One thing (D267), the phone's version of desktop's: the next task of Today, Done or Not now. No counts. */
export function OneThing({ vms }: { vms: readonly TaskVM[] }) {
  const c = useColors();
  const rules = useSettings((s) => s.settings.matrix);
  const oneThing = useSettings((s) => s.settings.oneThing);
  const lists = useData((s) => s.lists);
  const today = todayLocal();
  const vm = pickOneThing(vms, today, rules, oneThing.energy);
  const minutes = vm && taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin });
  const notNow = (v: TaskVM) => void editTask(v.task.id, { schedule: moveToDate(v.key ? scheduleForKey(v.task.schedule, v.key) : v.task.schedule, addDaysLocal(today, 1)) }, v.key);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
      <Segmented value={oneThing.energy} options={ENERGY} onChange={(energy) => useSettings.getState().update({ oneThing: { ...oneThing, energy } })} />
      {vm ? (
        <Card style={{ padding: 24, gap: 12, alignItems: "center" }}>
          <Text variant="heading" style={{ textAlign: "center" }} onPress={() => openTaskDetails(vm)}>
            {vm.task.title}
          </Text>
          <Text variant="meta" style={{ color: c.muted, fontVariant: ["tabular-nums"] }}>
            {[lists[vm.task.listId]?.name, vm.task.deadline && `by ${relativeDayLabel(vm.task.deadline, today)}`, minutes && formatMinutes(minutes)].filter(Boolean).join(" · ")}
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Button label="Done" icon="check" onPress={() => toggleDone(vm.task.id, vm.key)} />
            <Button label="Not now" icon="sunrise" kind="secondary" onPress={() => notNow(vm)} />
          </View>
        </Card>
      ) : (
        <Text variant="secondary" style={{ color: c.muted, textAlign: "center" }}>
          {oneThing.energy === "low" ? "Nothing of 15 minutes or less today. Give tasks a duration, like “15m”." : "Nothing left for today."}
        </Text>
      )}
    </View>
  );
}
