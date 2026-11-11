// The app shares ../src (domain, db, stores, sync) with the desktop app (PLAN D229). The repo
// isn't an npm workspace, so Metro is told about the parent folder and its node_modules here.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(repoRoot, "node_modules")];

module.exports = config;
