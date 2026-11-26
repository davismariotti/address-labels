/* Packaged app smoke test. Skipped unless `npm run package` has been run. */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const H = require('./helpers');

const APP = path.join(H.ROOT, 'dist', 'Address Labels-darwin-arm64', 'Address Labels.app');
const BIN = path.join(APP, 'Contents', 'MacOS', 'Address Labels');

test.describe('packaged app', () => {
  test.skip(!fs.existsSync(BIN), 'run `npm run package` first');

  test('bundle has our icon and none of the dev or personal files', async () => {
    // electron-packager copies the .icns over the bundle's CFBundleIconFile (electron.icns).
    const plist = fs.readFileSync(path.join(APP, 'Contents', 'Info.plist'), 'utf8');
    const iconName = /<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)[1];
    expect(fs.readFileSync(path.join(APP, 'Contents', 'Resources', iconName)).equals(fs.readFileSync(path.join(H.ROOT, 'build', 'icon.icns')))).toBe(true);

    const asar = spawnSync(path.join(H.ROOT, 'node_modules', '.bin', 'asar'), ['list', path.join(APP, 'Contents', 'Resources', 'app.asar')]);
    const files = asar.stdout.toString().split('\n');
    expect(files).toContain('/src/main/main.js');
    for (const gone of ['/addresses.json', '/settings.json', '/projects.json', '/addresses.pre-migration', '/settings.pre-projects', '/test/', '/openspec/', '/backups/', '/Holiday Cards.pdf', '/Holiday Cards.pages', '/docs/']) {
      expect(files.some((f) => f === gone || f.startsWith(gone)), gone).toBe(false);
    }
  });

  test('first run: data lives in userData, and a legacy addresses.json is offered, not copied', async () => {
    const userData = H.tmpDir();
    const legacy = path.join(H.tmpDir(), 'addresses.json');
    fs.writeFileSync(legacy, JSON.stringify(H.fixture('small.json')));
    const app = await electron.launch({ executablePath: BIN, args: [`--user-data-dir=${userData}`], env: { ...process.env, ADDRESS_LABELS_DATA: '', ADDRESS_LABELS_LEGACY: legacy } });
    const win = await app.firstWindow();
    await expect(win.locator('.empty h2')).toHaveText('No addresses yet');
    expect(fs.existsSync(path.join(userData, 'addresses.json'))).toBe(false);
    await win.click('.empty .btn:has-text("Import addresses.json")');
    await expect(win.locator('.row')).toHaveCount(10);
    expect(fs.existsSync(path.join(userData, 'addresses.json'))).toBe(true); // data folder = userData
    // projects live in the same folder, and are saved there
    await win.click('#select-all');
    await win.click('#new-from-selection');
    await win.fill('.modal input[aria-label="Project name"]', 'Packaged project');
    await win.click('.modal .btn.primary');
    await win.waitForSelector('#print');
    await new Promise((r) => setTimeout(r, 600));
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8')).projects[0].name).toBe('Packaged project');
    await app.close();
  });

  test('packaged app saves a PDF', async () => {
    const dir = H.tmpDir();
    H.seed(dir, H.fixture('small.json'));
    const out = path.join(H.tmpDir(), 'p.pdf');
    const app = await electron.launch({ executablePath: BIN, args: [`--user-data-dir=${H.tmpDir()}`], env: { ...process.env, ADDRESS_LABELS_DATA: dir, ADDRESS_LABELS_TEST_PDF: out } });
    const win = await app.firstWindow();
    await win.click('#select-all');
    await win.click('#new-from-selection');
    await win.fill('.modal input[aria-label="Project name"]', 'Packaged test');
    await win.click('.modal .btn.primary');
    await win.waitForSelector('#print');
    await win.click('#print');
    let pw;
    for (let i = 0; i < 50 && !pw; i++) { pw = app.windows().find((w) => w.url().includes('print.html')); if (!pw) await new Promise((r) => setTimeout(r, 200)); }
    await pw.click('#pdf');
    await expect(pw.locator('#banners')).toContainText('Saved');
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
    await app.close();
  });
});
