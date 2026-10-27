// Browser layout review only; no mailbox or external network access is needed.
const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = path.resolve(__dirname, '../.tmp/email-design-preview');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const profile = mkdtempSync(path.join(output, 'chrome-'));
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${profile}`,
    '--remote-debugging-port=9338', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let tab;
    for (let i = 0; i < 100 && !tab; i++) {
      try { tab = (await (await fetch('http://127.0.0.1:9338/json')).json()).find(item => item.type === 'page'); } catch {}
      if (!tab) await delay(100);
    }
    if (!tab) throw new Error('Preview browser did not start.');
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(resolve => { socket.onopen = resolve; });
    let id = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (pending.has(data.id)) {
        const task = pending.get(data.id); pending.delete(data.id);
        data.error ? task.reject(data.error) : task.resolve(data.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id; pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    for (const [name, width, height] of [['approval', 800, 900], ['verification', 390, 1000], ['interview', 320, 1100]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await send('Page.navigate', { url: pathToFileURL(path.join(output, `${name}.html`)).href });
      await delay(250);
      const metrics = await send('Runtime.evaluate', { expression: '({width: innerWidth, content: document.documentElement.scrollWidth})', returnByValue: true });
      const actual = metrics.result.value;
      if (actual.width !== width || actual.content > width) throw new Error(`Overflow in ${name}: ${JSON.stringify(actual)}`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(output, `${name}-${width}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`PASS: ${name} at ${width}px, no horizontal overflow.`);
    }
    await send('Browser.close');
  } finally { socket?.close(); browser.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
