/**
 * Dashboard-shaped child process for tests/shutdown-process.test.ts.
 *
 * Reproduces the mechanism behind the 90 s `systemctl stop` hang: a listening
 * HTTP server keeps the event loop alive, and a SIGTERM listener that tidies up
 * WITHOUT exiting — exactly what puppeteer's `handleSIGTERM` default installs
 * for every browser a plugin launches — means Node never applies its default
 * "terminate on SIGTERM". Env knobs:
 *   NO_LIFECYCLE=1   do not install the dashboard's lifecycle (the control)
 *   HANG_PLUGINS=1   the plugin close never resolves (deadline path)
 *   DEADLINE_MS=n    overall shutdown deadline
 */
import http from 'node:http';
import { installProcessLifecycle } from '../../src/process-lifecycle.js';

const say = (line: string): void => { process.stdout.write(`${line}\n`); };

// What @puppeteer/browsers registers per launched browser: close it, keep running.
process.on('SIGTERM', () => { say('PUPPETEER-LIKE-LISTENER'); });

const http1 = http.createServer((_req, res) => { res.end('ok'); });

const log = {
  info: (_o: unknown, msg?: string) => say(`INFO ${msg ?? ''}`),
  warn: (_o: unknown, msg?: string) => say(`WARN ${msg ?? ''}`),
  error: (_o: unknown, msg?: string) => say(`ERROR ${msg ?? ''}`),
};

const server = {
  log,
  close: () => new Promise<void>((done) => { http1.close(() => { say('HTTP-CLOSED'); done(); }); }),
  pluginManager: {
    shutdownAll: process.env['HANG_PLUGINS'] === '1'
      ? () => new Promise<void>(() => {})
      : async () => { say('PLUGINS-CLOSED'); },
  },
};

http1.listen(0, '127.0.0.1', () => {
  if (process.env['NO_LIFECYCLE'] !== '1') {
    installProcessLifecycle(server, {
      deadlineMs: Number(process.env['DEADLINE_MS'] ?? 20_000),
      stepTimeoutMs: 60_000,
      closeAllBrowsers: async () => { say('BROWSERS-CLOSED'); },
      sweep: async () => ({ removed: [], keptInUse: [], keptYoung: [], errors: [] }),
    });
  }
  say('READY');
});
