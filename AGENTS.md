# Repository Guidelines

## Project Structure & Module Organization

`App.js` bootstraps the React Native client, delegating screens and shared UI to `components/`, `redux/`, `utils/`, and `Themes/`. Assets (fonts, styles, media) live in `assets/`, while Expo web entry points are in `web/` and `public/`. Firebase Cloud Functions and tooling sit inside `functions/` and `firebase_tool/`, and Jest suites mirror source folders under `__tests__/` for quick cross-referencing.

## Build, Test, and Development Commands

Install dependencies with `npm install` using Node.js 14.21.x. Start Metro and Expo with `npm start`; target devices via `npm run ios`, `npm run android`, or `npm run web`. Create a static bundle using `npm run build-web`. When caching causes stale assets, reset the bundler with `npm run start-clean`. Apply repository formatting before commits through `npm run format-code`.

## Coding Style & Naming Conventions

Prettier governs formatting (4-space indent, single quotes, trailing commas). React components and screens use PascalCase (`ProjectDetailedView.js`); hooks, helpers, and Redux modules stay camelCase (`useComments.js`, `taskActions.js`). Keep mocks and fixtures alongside their feature directories. Husky executes `pretty-quick --staged`, so ensure staged files already match Prettier output to avoid failing hooks.

## Testing Guidelines

Tests run on Jest with the React Native preset and JSDOM environment. Place suites in `__tests__/Feature/Component.test.js` or embed `.test.js` beside leaf modules when appropriate. Maintain or raise the global 10% coverage thresholds defined in `package.json`, prioritizing meaningful coverage on touched code. Execute `npm test` for the default watch run, regenerate snapshots via `npm run update-snapshots`, and capture reports with `npm run coverage` before large merges.

## Commit & Pull Request Guidelines

Commit summaries follow the repository convention of short, sentence-case statements (`Adjust workflow tool layout`). Keep logical changes isolated and include follow-up details in the body when necessary. Pull requests should describe intent, link related issues, and show UI changes with screenshots or GIFs. Note any environment variable updates or migration steps explicitly, and list the commands or devices used during verification.

## Environment & Secrets

Respect the versions pinned in `README.md` (Node 14.21.3, npm 6.14.18, Expo CLI 6.1.0). Environment data resides in `.env`, `envs/`, and `env_functions*.json`; never commit real keys. Request Algolia, Firebase, and Sentry credentials from maintainers, store them using the existing naming scheme, and update GitLab CI variables in tandem for staging and production.
