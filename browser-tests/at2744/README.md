# AT-2744: Collapsible mobile goal tags

This corrects the automatic wrapping shipped in MR !657. Compact navigation
(up to 818px with the sidebar expanded) shows a separate milestone date and
one shared `TaskSummarizeTags` chip. Clicking it reveals the existing goal
badges and assignees in a second row; clicking again collapses them. That row
scrolls horizontally when necessary, preserving one expanded row without page
overflow. The summary count excludes the milestone date and includes schedule,
coffee, focus area and visible assignee tags. Desktop rendering is retained.

The harness renders the real goal header, progress bars, task/coffee counters,
schedule/focus badges, milestone date, reminder date, assignee wrappers,
Swipeable and AppPopover. Account/backend/navigation boundaries, rich-title
parsing and modal contents are fixtures. External requests are blocked and no
production data is read or written. These are local component-harness checks,
not authenticated production verification or physical-device tests.

With Node 22, existing root/web-bundler dependencies and Playwright Chromium:

```bash
node browser-tests/at2744/run.js
npm test -- --runInBand --watch=false \
    components/GoalsView/GoalMobileTags.test.js \
    components/GoalsView/GoalItemPresentationSwipeGuard.test.js \
    components/UIControls/GoalDateTagButton.test.js \
    __tests__/Tags/TaskSummarizeTags.test.js
```

`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` can point to an existing
Playwright installation. `--skip-build` reuses the compiled bundle;
`HARNESS_OUTPUT` sets its output folder (default: ignored `.build/`).
`--desktop-only` captures six desktop baselines. `DESKTOP_BASELINE` points to
screenshots from master captured with the same harness/browser/fonts; all six
must be byte-identical to the corrected desktop screenshots.

Checks cover mobile widths 320, 360, 375, 390, 430, 600 and 818px, desktop
900, 1024 and 1280px, long labels and eight avatars, initial collapse,
expand/re-collapse, separate nonduplicated milestone date, card/page overflow,
following-task overlap, backlog date, reminder date, organize mode, badge
navigation and popup triggers, title editing, and mounted desktop/mobile resize.
Jest also covers tag-count edge cases, hidden avatars, non-linear milestones,
standalone goals, done assignees, and permission propagation.

[Collapsed mobile](screenshots/mobile-after.png),
[expanded mobile](screenshots/mobile-expanded.png),
[long labels and eight avatars](screenshots/mobile-long.png).

Production builds and CI/deployment verification are recorded separately in
the correction MR. Live Goals verification requires an authorized browser
session; never use production badge actions that write data during that check.
