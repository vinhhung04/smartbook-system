// Wraps app.json so a release build cannot be produced against an unusable API URL.
// Expo inlines EXPO_PUBLIC_* at bundle time, so a "<placeholder>" or localhost left in
// the build environment would otherwise ship inside the APK and every request on a real
// phone would fail. The same rules run on the device in src/api/config.ts.
//
// EAS sets EAS_BUILD_PROFILE. Release profiles (preview, production) need HTTPS to a
// real host; development builds may use a LAN http:// gateway. Plain `expo start`
// (no profile) is not checked — the app falls back to the dev machine's address there.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '10.0.2.2']);
const RELEASE_PROFILES = new Set(['preview', 'production']);

function checkApiBaseUrl(raw, requireHttps) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return 'EXPO_PUBLIC_API_BASE_URL is not set';
  if (/[<>]/.test(value)) return `EXPO_PUBLIC_API_BASE_URL is still a placeholder: ${value}`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `EXPO_PUBLIC_API_BASE_URL is not a valid URL: ${value}`;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'EXPO_PUBLIC_API_BASE_URL must start with http:// or https://';
  if (requireHttps && parsed.protocol !== 'https:') return 'release builds must reach the API Gateway over https://';
  if (requireHttps && LOCAL_HOSTS.has(parsed.hostname)) return 'release builds must not point at localhost';
  return null;
}

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile) {
    const problem = checkApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, RELEASE_PROFILES.has(profile));
    if (problem) {
      throw new Error(
        `[app.config] ${problem} (EAS profile "${profile}"). ` +
          'Set it with: eas env:create --environment <preview|production> --name EXPO_PUBLIC_API_BASE_URL --value https://api.your-domain',
      );
    }
  }
  return config;
};

module.exports.checkApiBaseUrl = checkApiBaseUrl;
