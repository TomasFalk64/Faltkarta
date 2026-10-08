const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const papaSource = require.resolve("papaparse/papaparse.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // SDK 57's transformer overflows on Papa Parse's pre-minified browser entry.
  // Use the same package's source; Metro still minifies the release bundle.
  if (moduleName === "papaparse") {
    return {
      type: "sourceFile",
      filePath: papaSource,
    };
  }
  // Papa's optional Node stream API is not available on mobile. Faltkarta only
  // calls unparse(); do not add a Node stream polyfill to the application.
  if (moduleName === "stream" && context.originModulePath === papaSource) {
    return { type: "empty" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
