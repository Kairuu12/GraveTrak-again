// End-to-end settings test against an isolated Django database and built UI.
// Requires the existing project Python venv, Node 22+, Chrome, and npm run build.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/settings-browser-review');
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], consoleErrors = [], failedAPI = [];
let api, chrome, server, socket;

(async () => {
  try {
    api = spawn(process.env.PYTHON_PATH || path.join(root, 'backend/venv/Scripts/python.exe'), ['-u', path.join(__dirname, 'settings_browser_server.py')], { cwd: root, windowsHide: true });
    let apiLog = '', token;
    api.stdout.on('data', chunk => {
      apiLog += chunk;
      for (const line of apiLog.split(/\r?\n/)) { try { const data = JSON.parse(line); if (data.ready) token = data.token; } catch {} }
    });
    api.stderr.on('data', chunk => { apiLog += chunk; });
    for (let i = 0; i < 150 && !token; i++) await delay(100);
    assert.ok(token, 'Isolated API did not start: ' + apiLog.replace(/"token":\s*"[^"]+"/g, '"token":"redacted"'));
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html' };
    const dist = path.join(root, 'frontend/dist');
    server = http.createServer((req, res) => {
      let file = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5179, '127.0.0.1', resolve); });
    const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const chromeProfile = fs.mkdtempSync(path.join(output, 'chrome-'));
    chrome = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9346', `--user-data-dir=${chromeProfile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let tabs;
    for (let i = 0; i < 100; i++) { try { tabs = await (await fetch('http://127.0.0.1:9346/json')).json(); break; } catch { await delay(100); } }
    assert.ok(tabs, 'Chrome did not start');
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const pending = new Map(); let nextId = 0;
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task.reject(data.error) : task.resolve(data.result); }
      else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
      else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') consoleErrors.push(data.params.args.map(arg => arg.value || arg.description).join(' '));
      else if (data.method === 'Network.responseReceived' && data.params.response.url.includes(':8016/api/') && data.params.response.status >= 400) failedAPI.push({ url: data.params.response.url, status: data.params.response.status });
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => { for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body?.innerText?.slice(0,800)') + '\n' + JSON.stringify({ errors, consoleErrors, failedAPI })); };
    const click = async (selector, text) => {
      const found = await evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.includes(${JSON.stringify(text)}) && el.getBoundingClientRect().height); if (!node) return false; node.focus(); node.click(); return true; })()`);
      assert.ok(found, `Missing control: ${text}`); await delay(150);
    };
    const fill = (id, value) => evaluate(`(() => {const node=document.querySelector(${JSON.stringify(id)});if(!node)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const snapshot = async name => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64')); };
    const settings = async () => {
      await waitFor("Boolean(document.querySelector('.pub-nav-item'))");
      if (await evaluate("[...document.querySelectorAll('.pub-nav-item')].some(node => node.textContent.includes('Settings'))")) {
        await click('.pub-nav-item', 'Settings');
      } else {
        await click('#screen-public .profile', '');
        await click('#screen-public button', 'Profile Settings');
      }
      await waitFor("Boolean(document.querySelector('#settings-profile'))");
    };
    const saved = () => waitFor("!document.querySelector('.settings-options input[disabled]')");
    const preferences = () => evaluate("fetch('/api/profile/preferences/',{headers:{Authorization:'Token '+localStorage.getItem('authToken')}}).then(r=>r.json()).then(r=>r.preferences)");
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    // Settings verification does not depend on external fonts, tiles, or Turf.
    await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*cdn.jsdelivr.net*', '*tile.openstreetmap.org*', '*basemaps.cartocdn.com*'] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      if (!localStorage.getItem('settingsReviewStarted')) { localStorage.setItem('authToken', ${JSON.stringify(token)}); localStorage.setItem('token', ${JSON.stringify(token)}); localStorage.setItem('settingsReviewStarted','true'); }
      const originalFetch = window.fetch.bind(window);
      window.failSettingsSave = false;
      window.fetch = (input, options = {}) => {
        let url = String(input);
        if (url.includes('/api/')) { const parsed = new URL(url, location.origin); url = 'http://127.0.0.1:8016' + parsed.pathname + parsed.search; }
        if (window.failSettingsSave && url.includes('/profile/preferences/') && options.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({detail:'Intentional test failure'}), {status:503, headers:{'Content-Type':'application/json'}}));
        return originalFetch(url, options);
      };
    ` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5179/map' });
    await settings();
    assert.ok(await evaluate("document.querySelector('.user-settings').textContent.includes('Settings Reviewer')"));
    assert.equal(await evaluate("document.querySelectorAll('.settings-card').length"), 5);
    assert.equal(await evaluate("document.querySelectorAll('.settings-profile-grid input').length"), 0);
    assert.equal(await evaluate("document.querySelector('.settings-email-badge').textContent"), 'Not verified');
    await snapshot('email-unverified');
    await click('.settings-send-code', 'Send verification code');
    await waitFor("Boolean(document.querySelector('#email-verification-code'))");
    assert.ok(await evaluate("document.querySelector('.settings-send-code').disabled"));
    await snapshot('email-code');
    await fill('#email-verification-code', '999999');
    await click('.settings-verification-form button', 'Verify email');
    await waitFor("document.querySelector('.settings-email-verification [role=alert]')?.textContent.includes('Incorrect code')");
    await fill('#email-verification-code', '123456');
    await click('.settings-verification-form button', 'Verify email');
    await waitFor("Boolean(document.querySelector('.settings-email-badge.is-verified'))");
    await snapshot('email-verified');
    await send('Page.reload'); await settings();
    assert.ok(await evaluate("Boolean(document.querySelector('.settings-email-badge.is-verified'))"));
    assert.ok(await evaluate("document.querySelector('.settings-profile-grid').textContent.includes('09123456789')"));
    await snapshot('desktop-profile-security');

    await click('button', 'Edit Profile');
    await fill('#profile-email', 'invalid'); await click('button', 'Save Profile');
    await waitFor("Boolean(document.querySelector('#profile-email-error'))");
    await fill('#profile-email', 'taken@example.test'); await click('button', 'Save Profile');
    await waitFor("document.querySelector('#profile-email-error')?.textContent.includes('already in use')");
    await fill('#profile-email', 'settings-updated@example.test'); await fill('#profile-contact_number', '123'); await click('button', 'Save Profile');
    await waitFor("Boolean(document.querySelector('#profile-contact_number-error'))");
    await fill('#profile-contact_number', '+639123456789'); await fill('#profile-first_name', 'Updated M.');
    await click('button', 'Save Profile'); await waitFor("document.querySelector('.user-settings').textContent.includes('Profile updated.')");
    assert.ok(await evaluate("document.querySelector('.settings-profile-grid').textContent.includes('Updated M. Reviewer')"));
    assert.equal(await evaluate("document.querySelector('.settings-email-badge').textContent"), 'Not verified');

    await click('button', 'Change Password');
    await waitFor("Boolean(document.querySelector('[role=dialog]'))");
    await fill('#security-current_password', 'wrong'); await fill('#security-new_password', 'Replacement-Str0ng-Pass42!'); await fill('#security-confirm_password', 'Replacement-Str0ng-Pass42!');
    await click('button', 'Update Password'); await waitFor("document.querySelector('#security-current_password-error')?.textContent.includes('incorrect')");
    await fill('#security-current_password', 'Original-Secure-Pass23!'); await click('button', 'Update Password');
    await waitFor("document.querySelector('.user-settings').textContent.includes('Password updated.')");
    assert.equal(await evaluate("Boolean(document.querySelector('[role=dialog]'))"), false);

    await click('label', 'Dark'); await saved();
    assert.equal(await evaluate("document.documentElement.dataset.theme"), 'dark');
    assert.equal((await preferences()).theme, 'dark');
    await snapshot('desktop-dark');
    await click('label', 'Light'); await saved();
    assert.equal(await evaluate("document.documentElement.dataset.theme"), 'light');
    await click('label', 'System Default'); await saved();
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await waitFor("document.documentElement.dataset.theme === 'dark'");
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await waitFor("document.documentElement.dataset.theme === 'light'");
    await click('label', 'Large'); await saved();
    await evaluate("document.querySelector('#settings-contrast').click()"); await saved();
    await evaluate("document.querySelector('#settings-email').click()"); await saved();
    await evaluate("document.querySelector('#settings-announcements').click()"); await saved();
    const selected = await preferences();
    assert.equal(selected.theme, 'system'); assert.equal(selected.text_size, 'large'); assert.equal(selected.high_contrast, true);
    assert.equal(selected.email_notifications, false); assert.equal(selected.cemetery_announcements, false); assert.equal(selected.sms_notifications, false);
    assert.equal(await evaluate("getComputedStyle(document.body).filter"), 'none');
    await evaluate("document.querySelector('#settings-appearance').scrollIntoView({block:'start'})"); await snapshot('desktop-appearance');

    await evaluate('window.failSettingsSave = true'); await click('label', 'Dark');
    await waitFor("document.querySelector('.settings-save-error')?.textContent.includes('restored')");
    assert.equal(await evaluate("document.documentElement.dataset.theme"), 'light');
    await evaluate('window.failSettingsSave = false');
    await click('label', 'System Default'); await saved();
    await send('Page.reload'); await settings();
    assert.deepEqual(await preferences(), selected);
    assert.equal(await evaluate("document.querySelector('#screen-public').dataset.textSize"), 'large');
    assert.equal(await evaluate("document.querySelector('#screen-public').dataset.contrast"), 'high');
    for (const width of [768, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await delay(250);
      await evaluate("document.querySelector('.pub-page').scrollTop = 0");
      assert.ok(await evaluate("(() => { const p = document.querySelector('.pub-page'); return p.scrollWidth <= p.clientWidth + 1 && document.querySelector('.user-settings').getBoundingClientRect().right <= innerWidth + 1; })()"), `Settings overflow at ${width}px`);
      await snapshot(`settings-${width}`);
    }
    await click('button', 'Change Password'); await waitFor("Boolean(document.querySelector('[role=dialog]'))");
    assert.ok(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().right <= innerWidth"));
    assert.ok(await evaluate("(() => { const rect=document.querySelector('.settings-password-dialog').getBoundingClientRect(); return rect.x === 0 && rect.y === 0 && rect.width >= innerWidth && rect.height >= innerHeight; })()"), 'Password backdrop must cover the viewport');
    await evaluate("document.querySelector('.settings-password-dialog button[type=submit]').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.ok(await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)"));
    await snapshot('mobile-password-dialog');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor("!document.querySelector('[role=dialog]')");
    assert.equal(await evaluate('document.activeElement.textContent'), 'Change Password');
    await click('.user-settings button', 'Sign Out');
    await waitFor("Boolean(document.querySelector('#screen-auth.active'))");
    await fill('#screen-auth input[type=text]', 'settings-updated@example.test');
    await fill('#screen-auth input[type=password]', 'Replacement-Str0ng-Pass42!');
    await click('#screen-auth button', 'Sign In'); await settings();
    assert.deepEqual(await preferences(), selected);
    assert.ok(await evaluate("document.querySelector('.settings-profile-grid').textContent.includes('Updated M. Reviewer')"));
    assert.deepEqual(errors, []);
    const unexpectedConsole = consoleErrors.filter(text => !text.includes('[API Error]'));
    assert.deepEqual(unexpectedConsole, []);
    assert.ok(failedAPI.every(item => item.status === 400 && (item.url.endsWith('/profile/') || item.url.endsWith('/change-password/') || item.url.endsWith('/email-verification/confirm/'))), JSON.stringify(failedAPI));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, runtimeErrors: errors, unexpectedConsoleErrors: unexpectedConsole, expectedValidationResponses: failedAPI, viewports: [1365, 768, 390, 320], checks: ['profile validation and save', 'password validation and rotation', 'theme and OS changes', 'text size and contrast', 'channel preferences', 'save rollback', 'refresh persistence', 'logout/login persistence', 'responsive overflow', 'modal focus and Escape'] }, null, 2));
    console.log('PASS: real settings APIs, profile, password, all preferences, save failure recovery, refresh/logout/login, 4 viewport sizes, modal keyboard handling, no unexpected console/API errors.');
    await send('Browser.close');
  } finally {
    socket?.close(); chrome?.kill(); api?.kill(); server?.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
