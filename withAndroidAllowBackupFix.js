const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidAllowBackupFix(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    mainApplication.$['android:allowBackup'] = 'false';
    mainApplication.$['tools:replace'] = 'android:allowBackup';

    androidManifest.manifest.$['xmlns:tools'] =
      'http://schemas.android.com/tools';

    return config;
  });
};