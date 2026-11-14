// Android long-press shortcut "Add task" on the launcher icon: opens momentum://quickadd (the closest Android
// equivalent to iOS's lock-screen quick add; expo-widgets can't make widget taps open the app).
const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const SHORTCUTS = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="add_task" android:enabled="true" android:shortcutShortLabel="@string/shortcut_add_task">
    <intent android:action="android.intent.action.VIEW" android:data="momentum://quickadd" android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity" />
  </shortcut>
</shortcuts>
`;

module.exports = (config) => {
  config = withAndroidManifest(config, (c) => {
    const main = c.modResults.manifest.application[0].activity.find((a) => a.$["android:name"] === ".MainActivity");
    main["meta-data"] = [...(main["meta-data"] ?? []).filter((m) => m.$["android:name"] !== "android.app.shortcuts"), { $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" } }];
    return c;
  });
  return withDangerousMod(config, [
    "android",
    (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, "app/src/main/res");
      fs.mkdirSync(path.join(res, "xml"), { recursive: true });
      fs.writeFileSync(path.join(res, "xml/shortcuts.xml"), SHORTCUTS(c.android.package));
      // Appended to strings.xml, once.
      const strings = path.join(res, "values/strings.xml");
      const xml = fs.readFileSync(strings, "utf8");
      if (!xml.includes("shortcut_add_task")) fs.writeFileSync(strings, xml.replace("</resources>", '  <string name="shortcut_add_task">Add task</string>\n</resources>'));
      return c;
    },
  ]);
};
