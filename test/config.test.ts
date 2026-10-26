import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { APP_PASSWORD: 'pw', API_TOKEN: 'tok', DATA_DIR: '/tmp/data' };

describe('loadConfig', () => {
  it.each(['APP_PASSWORD', 'API_TOKEN', 'DATA_DIR'])('throws naming %s when missing', (name) => {
    const env = { ...base } as Record<string, string | undefined>;
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('returns defaults when required vars are present', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(8080);
    expect(cfg.tesseractLangs).toBe('chi_sim+eng');
    expect(cfg.dataDir).toBe('/tmp/data');
  });
});
