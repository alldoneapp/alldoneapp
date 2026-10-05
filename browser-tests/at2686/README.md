AT-2686 feedback screenshots show the real OKR component DOM from the regression
fixtures in `components/TaskListView/OKRs/OKRTodayVisibility.test.js`, rendered in
headless Chromium. Persistence, icons, revenue values and translation metadata are
mocked; the pending/error messages use the English translations. These are UI
fixtures, not production screenshots or evidence of a successful server write.

- `screenshots/pending-desktop.png`: pending write, disabled action.
- `screenshots/error-desktop.png`: rejected write, visible error and retry.
- `screenshots/pending-mobile.png`: pending feedback in the mobile layout.

Run the interaction regression tests with:

```sh
npm test -- --runInBand components/TaskListView/OKRs/OKRTodayVisibility.test.js
```
