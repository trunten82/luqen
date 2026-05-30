// Serves ONE page combining a keyboard trap (WCAG 2.1.2) and a missing focus
// indicator (2.4.7), so a single deep-behavioral scan produces both findings.
// Bound to loopback (127.0.0.1) on a dedicated port; the dashboard reaches it
// only because the UAT config sets allowPrivateScanTargets: true (the SSRF
// escape hatch under test). Writes the resolved URL to .tmp/fixture-url.txt.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.UAT_FIXTURE_HOST || '127.0.0.1';
const PORT = Number(process.env.UAT_FIXTURE_PORT || 0);
const URL_FILE = path.join(HERE, '.tmp', 'fixture-url.txt');

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>UAT behavioral fixture</title>
<style>
  /* Missing focus indicator: kill outline with no alternative for #ghost */
  #ghost, #ghost:focus { outline: none; border: none; box-shadow: none; }
  button#first:focus, input#trap:focus, button#after:focus { outline: 2px solid blue; }
</style>
</head>
<body>
  <h1>UAT behavioral fixture</h1>

  <!-- Keyboard trap: #trap swallows Tab so focus can never leave via keyboard -->
  <button type="button" id="first">First</button>
  <input type="text" id="trap" aria-label="Trapped field">
  <button type="button" id="after">After</button>

  <!-- Missing focus indicator -->
  <button type="button" id="ghost">Invisible focus</button>

  <script>
    var trap = document.getElementById('trap');
    trap.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); }
    });
  </script>
</body></html>`;

const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE);
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const url = `http://${HOST}:${addr.port}/`;
  fs.mkdirSync(path.dirname(URL_FILE), { recursive: true });
  fs.writeFileSync(URL_FILE, url);
  // eslint-disable-next-line no-console
  console.log('FIXTURE_LISTENING ' + url);
});

// Keep alive until killed by the orchestrator.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
