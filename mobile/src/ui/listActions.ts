import { router } from "expo-router";
import { Alert } from "react-native";
import type { Folder, TaskList } from "@core/domain/types";
import { addFolder, addList, addSection, removeFolder, removeList, removeSection, removeTag, updateFolder, updateList, updateSection, updateTag, useData } from "@core/stores/data";
import { withStructureUndo } from "@core/stores/undo";
import { useSocial } from "@core/stores/social";
import { roleFor } from "@/social/roles";
import { askText, choose, type Choice } from "./Sheet";

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
  const role = roleFor(useSocial.getState().shares, useData.getState().lists, useData.getState().folders, l.id);
  // Owners manage the list; members only open its sharing (D262).
  const manage: Choice<string>[] = role === "viewer" || role === "editor" ? [] : [
    { value: "rename", label: "Rename", icon: "edit-2" },
    { value: "color", label: "Colour", icon: "droplet" },
    ...(folders.length ? [{ value: "move", label: "Move to folder", icon: "folder" } as const] : []),
    { value: "sections", label: "Sections", icon: "columns" },
    { value: "archive", label: "Archive list", icon: "archive" },
    { value: "delete", label: "Delete list", icon: "trash-2", danger: true },
  ];
  const action = await choose<string>(l.name, [{ value: "share", label: role ? "Sharing" : "Share", icon: "users" }, ...manage]);
  if (action === "share") router.push({ pathname: "/share", params: { kind: "list", id: l.id } });
  else if (action === "sections") await sectionsMenu(l);
  else if (action === "archive") {
    updateList(l.id, { archived: true });
    router.canGoBack() && router.back();
  } else if (action === "rename") {
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
      { text: "Delete", style: "destructive", onPress: () => (router.canGoBack() && router.back(), withStructureUndo(`Deleted “${l.name}”`, () => removeList(l.id))) },
    ]);
  }
}

export async function folderMenu(f: Folder) {
  const action = await choose(f.name, [
    { value: "share", label: "Share", icon: "users" },
    { value: "list", label: "New list in this folder", icon: "plus" },
    { value: "rename", label: "Rename", icon: "edit-2" },
    { value: "delete", label: "Delete folder", detail: "Lists are kept", icon: "trash-2", danger: true },
  ]);
  if (action === "share") router.push({ pathname: "/share", params: { kind: "folder", id: f.id } });
  else if (action === "list") {
    const name = await askText("New list", { placeholder: "Chemistry", confirm: "Create" });
    if (name) router.push({ pathname: "/browse/list/[id]", params: { id: addList(name, f.id).id } });
  } else if (action === "rename") {
    const name = await askText("Rename folder", { value: f.name });
    if (name) updateFolder(f.id, { name });
  } else if (action === "delete") removeFolder(f.id);
}

/** A list's sections: add, rename, delete (tasks in a deleted section stay in the list). */
export async function sectionsMenu(l: TaskList) {
  const secs = Object.values(useData.getState().sections).filter((x) => x.listId === l.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const pick = await choose<string>(`${l.name}: sections`, [{ value: "", label: "New section", icon: "plus" }, ...secs.map((x) => ({ value: x.id, label: x.name, icon: "columns" as const }))]);
  if (pick === null) return;
  if (pick === "") {
    const name = await askText("New section", { confirm: "Create" });
    if (name) addSection(l.id, name);
    return;
  }
  const sec = secs.find((x) => x.id === pick);
  if (!sec) return;
  const action = await choose(sec.name, [{ value: "rename", label: "Rename", icon: "edit-2" }, { value: "delete", label: "Delete section", icon: "trash-2", danger: true }]);
  if (action === "rename") {
    const name = await askText("Rename section", { value: sec.name });
    if (name) updateSection(sec.id, { name });
  } else if (action === "delete") withStructureUndo(`Deleted section “${sec.name}”`, () => removeSection(sec.id));
}

/** Archived lists are hidden from Browse; pick one to bring it back. */
export async function archivedMenu() {
  const archived = Object.values(useData.getState().lists).filter((l) => l.archived);
  const pick = await choose<string>("Archived lists", archived.map((l) => ({ value: l.id, label: l.name, icon: "archive" as const })));
  if (pick) updateList(pick, { archived: false });
}

/** Rename, recolour or delete tags (new ones are made by typing #tag on a task). */
export async function tagsMenu() {
  const tags = Object.values(useData.getState().tags).sort((a, b) => a.name.localeCompare(b.name));
  if (!tags.length) return void (await choose("No tags yet", [{ value: "ok", label: "Type #tag on a task to make one", icon: "tag" }]));
  const pick = await choose<string>("Tags", tags.map((t) => ({ value: t.id, label: t.name, icon: "tag" as const })));
  const tag = tags.find((t) => t.id === pick);
  if (!tag) return;
  const action = await choose(tag.name, [{ value: "rename", label: "Rename", icon: "edit-2" }, { value: "delete", label: "Delete tag", icon: "trash-2", danger: true }]);
  if (action === "rename") {
    const name = await askText("Rename tag", { value: tag.name });
    if (name) updateTag(tag.id, { name });
  } else if (action === "delete") withStructureUndo(`Deleted tag “${tag.name}”`, () => removeTag(tag.id));
}
