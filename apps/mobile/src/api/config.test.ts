import { checkApiBaseUrl } from './config';

describe('checkApiBaseUrl', () => {
  it('accepts an https gateway and strips the trailing slash', () => {
    expect(checkApiBaseUrl('https://api.example.vn/', { requireHttps: true })).toEqual({ ok: true, url: 'https://api.example.vn' });
  });

  it('rejects a missing value', () => {
    expect(checkApiBaseUrl(undefined, { requireHttps: false }).ok).toBe(false);
    expect(checkApiBaseUrl('  ', { requireHttps: false }).ok).toBe(false);
  });

  it('rejects placeholders left in eas.json', () => {
    expect(checkApiBaseUrl('https://<production-domain-not-set-yet>', { requireHttps: true }).ok).toBe(false);
    expect(checkApiBaseUrl('http://<lan-ip>:3000', { requireHttps: false }).ok).toBe(false);
  });

  it('requires https and a real host for release builds', () => {
    expect(checkApiBaseUrl('http://api.example.vn', { requireHttps: true }).ok).toBe(false);
    expect(checkApiBaseUrl('https://localhost:3000', { requireHttps: true }).ok).toBe(false);
    expect(checkApiBaseUrl('https://127.0.0.1', { requireHttps: true }).ok).toBe(false);
  });

  it('allows a LAN http gateway for development builds', () => {
    expect(checkApiBaseUrl('http://192.168.1.20:3000', { requireHttps: false })).toEqual({ ok: true, url: 'http://192.168.1.20:3000' });
  });

  it('rejects non-http schemes and garbage', () => {
    expect(checkApiBaseUrl('ftp://api.example.vn', { requireHttps: false }).ok).toBe(false);
    expect(checkApiBaseUrl('not a url', { requireHttps: false }).ok).toBe(false);
  });
});
