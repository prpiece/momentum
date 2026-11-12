import { router } from "expo-router";
import { Alert } from "react-native";
import type { Folder, TaskList } from "@core/domain/types";
import { addFolder, addList, removeFolder, removeList, updateFolder, updateList, useData } from "@core/stores/data";
import { askText, choose } from "./Sheet";

/** The list colour presets (`--l-*`), as desktop stores them. */
export const LIST_COLORS = ["violet", "amber", "blue", "green", "coral", "teal"].map((k) => ({ value: `var(--l-${k})`, label: k[0].toUpperCase() + k.slice(1) }));

/** Lists and folders are managed on the phone too (S2): new, rename, colour, move, delete. */
export async function newListOrFolder(folderId: string | null = null) {
  const kind = await choose("New", [
    { value: "list", label: "List", icon: "list" },
    ...(folderId ? [] : [{ value: "folder", label: "Folder", icon: "folder" } as const]),
  ]);
  if (!kind) return;
  const name = await askText(kind === "list" ? "New list" : "New folder", { placeholder: kind === "list" ? "Chemistry" : "Uni", confirm: "Create" });
  if (!name) return;
  if (kind === "folder") return void addFolder(name);
  const l = addList(name, folderId);
  router.push({ pathname: "/browse/list/[id]", params: { id: l.id } });
}

export async function listMenu(l: TaskList, colorOf: (v: string) => string) {
  const folders = Object.values(useData.getState().folders);
  const action = await choose(l.name, [
    { value: "rename", label: "Rename", icon: "edit-2" },
    { value: "color", label: "Colour", icon: "droplet" },
    ...(folders.length ? [{ value: "move", label: "Move to folder", icon: "folder" } as const] : []),
    { value: "delete", label: "Delete list", icon: "trash-2", danger: true },
  ]);
  if (action === "rename") {
    const name = await askText("Rename list", { value: l.name });
    if (name) updateList(l.id, { name });
  } else if (action === "color") {
    const color = await choose("Colour", LIST_COLORS.map((o) => ({ ...o, color: colorOf(o.value), selected: o.value === l.color })));
    if (color) updateList(l.id, { color });
  } else if (action === "move") {
    const to = await choose<string>("Move to folder", [{ value: "", label: "No folder", icon: "slash", selected: !l.folderId }, ...folders.map((f) => ({ value: f.id, label: f.name, icon: "folder" as const, selected: f.id === l.folderId }))]);
    if (to !== null) updateList(l.id, { folderId: to || null });
  } else if (action === "delete") {
    const n = Object.values(useData.getState().tasks).filter((t) => t.listId === l.id && !t.deletedAt).length;
    Alert.alert(`Delete “${l.name}”?`, n ? `Its ${n} task${n > 1 ? "s are" : " is"} deleted too, on every device.` : "It's empty.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => (router.canGoBack() && router.back(), removeList(l.id)) },
    ]);
  }
}

export async function folderMenu(f: Folder) {
  const action = await choose(f.name, [
    { value: "list", label: "New list in this folder", icon: "plus" },
    { value: "rename", label: "Rename", icon: "edit-2" },
    { value: "delete", label: "Delete folder", detail: "Lists are kept", icon: "trash-2", danger: true },
  ]);
  if (action === "list") {
    const name = await askText("New list", { placeholder: "Chemistry", confirm: "Create" });
    if (name) router.push({ pathname: "/browse/list/[id]", params: { id: addList(name, f.id).id } });
  } else if (action === "rename") {
    const name = await askText("Rename folder", { value: f.name });
    if (name) updateFolder(f.id, { name });
  } else if (action === "delete") removeFolder(f.id);
}
