// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // This new rule (shipped with SDK 57's eslint-config-expo) flags the standard
      // "fetch on mount, track isLoading" effect pattern used throughout this app —
      // even the React-docs-recommended cancelled-flag variant still triggers it.
      // Fully satisfying it would mean moving all data fetching off useEffect (e.g.
      // to a query library), which is out of scope for an SDK bump.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
