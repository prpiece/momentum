// The app shares ../src (domain, db, stores, sync) with the desktop app (PLAN D229). The repo
// isn't an npm workspace, so Metro is told about the parent folder and its node_modules here.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(repoRoot, "node_modules")];

// Shared code (zustand in ../node_modules) would otherwise find the desktop's React copy next to it,
// and two Reacts break hooks. Every `react` import resolves from this app instead.
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    moduleName === "react" || moduleName.startsWith("react/") ? { ...context, originModulePath: path.join(projectRoot, "package.json") } : context,
    moduleName,
    platform,
  );

module.exports = config;
