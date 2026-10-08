const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidStorageLimit(config) {
  return withGradleProperties(config, (config) => {
    const key = 'AsyncStorage_db_size_in_MB';
    config.modResults = config.modResults.filter((entry) => entry.key !== key);
    config.modResults.push({ type: 'property', key, value: '30' });
    return config;
  });
};
