module.exports = function (api) {
  api.cache(true);
  return {
    // The `@/*` alias is resolved by tsconfig `paths` (honoured by Metro's
    // tsconfigPaths support in Expo SDK 53 and by jest's moduleNameMapper), so
    // no babel-plugin-module-resolver entry is needed here — it was never
    // installed and made every babel transform fail.
    presets: ['babel-preset-expo'],
  };
};
