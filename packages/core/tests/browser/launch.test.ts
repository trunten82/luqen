import { describe, it, expect, vi } from 'vitest';
import { launchChromium, CHROMIUM_LAUNCH_ARGS } from '../../src/browser/launch.js';
import { ChromiumNotFoundError } from '../../src/browser/resolve.js';

function fakePuppeteer() {
  return { launch: vi.fn().mockResolvedValue({ close: vi.fn() }) };
}

describe('launchChromium', () => {
  it('LC1: launch passes the resolved executable and the no-sandbox flags', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({}, { puppeteer, resolve });
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    const options = puppeteer.launch.mock.calls[0][0] as { executablePath: string; args: string[]; headless: boolean };
    expect(options.executablePath).toBe('/resolved/chrome');
    expect(options.args).toContain('--no-sandbox');
    expect(options.args).toContain('--disable-setuid-sandbox');
    expect(options.args).toContain('--disable-dev-shm-usage');
    expect(options.headless).toBe(true);
  });

  it('LC2: caller overrides are merged last', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({ headless: false, args: ['--custom-flag'] }, { puppeteer, resolve });
    const options = puppeteer.launch.mock.calls[0][0] as { headless: boolean; args: string[] };
    expect(options.headless).toBe(false);
    expect(options.args).toEqual(['--custom-flag']);
  });

  it('LC3: an explicit executablePath override skips resolution', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({ executablePath: '/manual/chrome' }, { puppeteer, resolve });
    expect(resolve).not.toHaveBeenCalled();
    const options = puppeteer.launch.mock.calls[0][0] as { executablePath: string };
    expect(options.executablePath).toBe('/manual/chrome');
  });

  it('LC4: an unresolvable browser rejects with ChromiumNotFoundError and never calls launch', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockRejectedValue(new ChromiumNotFoundError(['/a', '/b']));
    await expect(launchChromium({}, { puppeteer, resolve })).rejects.toBeInstanceOf(ChromiumNotFoundError);
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('exports the shared launch args as a stable tuple', () => {
    expect(CHROMIUM_LAUNCH_ARGS).toEqual(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']);
  });
});
