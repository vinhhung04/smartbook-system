/// <reference types="node" />
// app.config.js is what EAS evaluates before a build; a release with an unusable API URL must fail there.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../../app.config.js');

const baseConfig = { name: 'SmartBook', slug: 'mobile' };

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = { EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE, EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('app.config.js', () => {
  it('passes the config through for plain `expo start`', () => {
    withEnv({ EAS_BUILD_PROFILE: undefined, EXPO_PUBLIC_API_BASE_URL: undefined }, () => {
      expect(appConfig({ config: baseConfig })).toBe(baseConfig);
    });
  });

  it('refuses a release build with a placeholder, http or localhost URL', () => {
    for (const url of [undefined, 'https://<production-domain-not-set-yet>', 'http://api.example.vn', 'https://localhost:3000']) {
      withEnv({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_BASE_URL: url }, () => {
        expect(() => appConfig({ config: baseConfig })).toThrow(/app\.config/);
      });
    }
  });

  it('accepts an https gateway for production and a LAN gateway for development', () => {
    withEnv({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_BASE_URL: 'https://api.example.vn' }, () => {
      expect(appConfig({ config: baseConfig })).toBe(baseConfig);
    });
    withEnv({ EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_API_BASE_URL: 'http://192.168.1.10:3000' }, () => {
      expect(appConfig({ config: baseConfig })).toBe(baseConfig);
    });
  });
});
