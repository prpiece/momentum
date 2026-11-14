// Store build numbers come from the shared version (PLAN D257), so a release only bumps `version`
// in app.json. 1.2.3 → 10203. ponytail: minor and patch must stay below 100; switch to a counter if they don't.
const versionCode = (version) => {
  const [major, minor, patch] = version.split(".").map(Number);
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0) || minor > 99 || patch > 99) throw new Error(`Bad app version: ${version}`);
  return major * 10000 + minor * 100 + patch;
};

module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, versionCode: versionCode(config.version) },
  ios: { ...config.ios, buildNumber: String(versionCode(config.version)) },
});
module.exports.versionCode = versionCode;
