const os = require('node:os');

module.exports = {
  testDir: '.',
  testMatch: '*.spec.js',
  // Each test launches its own Electron app with its own data folder and user-data folder, so tests are independent.
  fullyParallel: true,
  workers: Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2))),
  timeout: 20000,
  expect: { timeout: 5000 },
  reporter: 'list',
};
