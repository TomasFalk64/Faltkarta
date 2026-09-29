module.exports = ({ config }) => {
  const dev = process.env.APP_VARIANT === "development";

  return {
    ...config,
    name: dev ? "Fältkarta Dev" : config.name,
    android: {
      ...config.android,
      package: dev ? "com.tf64.faltkarta.dev" : config.android.package,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: dev
        ? "com.tf64.faltkarta.dev"
        : config.ios.bundleIdentifier,
    },
  };
};
