const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
const shim = path.resolve(__dirname, "shots/nfc-shim.js");
const safe = path.resolve(__dirname, "shots/safe-area-shim.js");
const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-nfc-manager") return { type: "sourceFile", filePath: shim };
  if (moduleName === "react-native-safe-area-context" && !context.originModulePath.includes("safe-area-shim")) return { type: "sourceFile", filePath: safe };
  return (prev || context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
