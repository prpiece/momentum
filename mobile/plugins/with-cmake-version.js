// Android Gradle defaults to CMake 3.22.1, whose ninja (1.10) can't open paths over 260
// characters on Windows; React Native's codegen object paths exceed that inside C:\dev\momentum.
// CMake 4.x ships ninja 1.12, which honours Windows long paths. Gradle installs it if missing.
const { withAppBuildGradle } = require("expo/config-plugins");

const VERSION = "4.1.2";

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(`version "${VERSION}"`)) {
      c.modResults.contents = c.modResults.contents.replace(/\nandroid\s*\{/, `\nandroid {\n    externalNativeBuild { cmake { version "${VERSION}" } }`);
    }
    return c;
  });
