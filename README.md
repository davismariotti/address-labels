# Address Labels

A small macOS app that keeps an address book and prints Avery 5260 (30-up, 1" x 2⅝") label sheets,
including onto a partly used sheet.

## Run it
```
npm install
npm start
```
In development the data lives in this folder (`addresses.json`, `settings.json`, `backups/`, `logs/`).
Override with `ADDRESS_LABELS_DATA=/some/folder npm start`.

## Build the app
```
npm run package          # creates dist/Address Labels-darwin-arm64/Address Labels.app
```
The app is **unsigned**. The first time, right-click it in Finder and choose **Open**, then **Open** again.
The packaged app keeps its data in `~/Library/Application Support/Address Labels`, which is a
separate copy from the one in this folder. On first run it offers to import
`~/Documents/addresses/addresses.json`. Use **File ▸ Show Data Folder in Finder** to see where it is.

## Projects
The sidebar has your **Address book** and your **projects** (mailings such as "Christmas 2026"). Tick people in
the Address book and choose **Add to project…** or **New project from selection…**, or start a project as a copy
of another. Printing happens inside a project, which remembers what has been printed, flags addresses that
changed since, and lets you undo a run or just the labels that didn't come out. Data: `addresses.json`,
`projects.json`, `settings.json` (all in the data folder).

## Tests
```
npm test                 # unit tests (no Electron)
npm run test:coverage    # unit tests + 90% line gate on src/shared
npm run test:e2e         # drives the real app, in parallel (needs poppler for the PDF checks: brew install poppler)
npm run package && npx playwright test --config test/e2e/playwright.config.js packaged.spec.js
```
The e2e tests run in parallel: each test gets its own data folder and its own Electron user-data folder
(the app's single-instance lock is keyed to that folder).
Visual baselines (`test/e2e/visual.spec.js-snapshots`) are machine-specific. Regenerate them with
`--update-snapshots` if fonts or display scale differ.

Printer alignment can't be tested automatically. Follow `docs/calibration-checklist.md`.

## Layout
- `src/shared` pure logic: geometry, text fitting, layout, people model, settings (unit tested)
- `src/main` Electron main process: windows, menu, files, print/PDF
- `src/renderer` main window, print dialog, output page, design tokens
