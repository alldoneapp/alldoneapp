# AT-2669: background email check cadence in Chats

Use Node 22 and install the existing dependencies in the repository root,
`web-bundler/` and `functions/`, then run:

```sh
node browser-tests/at2669/run.js
```

The harness uses the repository's webpack pipeline and the real status component,
hooks, configuration subscription adapter and translations. Fixture replacements
provide only the backend and navigation boundaries; external requests are blocked.
Chromium and Puppeteer come from the existing Functions dependencies. Chromium
requires the host's NSS/NSPR libraries (`libnss3` and `libnspr4` on Ubuntu).

Checks run at 1280, 390 and 320 pixels: German cadence text, no horizontal overflow,
keyboard activation of the Integrations link, disabling automatic checks and removal
of the status banner and configuration listener after a successful health check.
Generated screenshots are saved in the ignored `.build/` directory.

Review captures: [desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png).

For the targeted unit and backend suites:

```sh
npm test -- --runInBand --watch=false --runTestsByPath \
  components/ChatsView/ChatsEmailConnectionStatus.test.js \
  components/ChatsView/useEmailCheckCadence.test.js \
  utils/backends/Gmail/gmailLabelingFirestore.test.js \
  components/ChatsView/ChatsView.test.js \
  components/SettingsView/Integrations/useConnectionHealth.test.js
npx jest --config ci/jest.functions.config.js --runInBand --runTestsByPath \
  functions/Gmail/gmailLabelingConfig.test.js \
  functions/Gmail/serverSideGmailLabelingSync.test.js
```

The cadence normalization is shared with the scheduled worker. Its existing
30-minute floor remains unchanged; the UI describes the interval as approximate
because the worker scans every five minutes. Missing persisted configuration is
shown as unconfigured even though the settings form supplies enabled defaults.
