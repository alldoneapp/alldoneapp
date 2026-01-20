# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alldone is a React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. Runs on iOS, Android, and web with shared codebase.

## Development Commands

```bash
# Development
npm start                    # Start Metro bundler
npm run web                  # Start web version (Expo)
npm run android              # Run on Android
npm run ios                  # Run on iOS
npm run start-clean          # Start with cache reset

# Firebase Functions (local)
firebase emulators:start --only functions --inspect-functions

# Testing
npm test                     # Run Jest tests
npm test -- --testPathPattern="TaskList"  # Run single test file
npm run coverage             # Generate test coverage
npm run update-snapshots     # Update Jest snapshots

# Build & Deploy
npm run build-web            # Build for web production
npm run format-code          # Format with Prettier
```

**Required versions**: Node 14.21.3, npm 6.14.18, expo-cli 6.1.0, firebase-tools 13.29.3

## Architecture Overview

### Directory Structure

-   `components/` - Feature-based UI (TaskListView/, GoalsView/, NotesView/, ContactsView/, etc.)
-   `utils/backends/` - Firebase abstraction layer (firestore.js, openTasks.js, doneTasks.js)
-   `utils/BackendBridge.js` - Central Firebase operations facade
-   `URLSystem/` - Custom routing with per-feature triggers and constants
-   `redux/` - State management (actions.js, store.js)
-   `functions/` - Firebase Cloud Functions (v2 syntax)
-   `i18n/translations/` - Localization (en.json, de.json, es.json)

### Key Patterns

**Backend Bridge**: `utils/BackendBridge.js` abstracts all Firebase operations. Feature-specific backends in `utils/backends/` (Tasks/, Goals/, Notes/, etc.).

**URL System**: `URLSystem/URLSystemTrigger.js` handles navigation. Each feature has its own trigger file (e.g., `URLSystem/Tasks/`).

**DetailedView Pattern**: Entity screens follow `[Entity]DetailedView` naming (TaskDetailedView, GoalDetailedView, ContactDetailedView).

**Real-time Collaboration**: Quill editor + Yjs for notes. Custom Quill modifications require replacing `node_modules/quill/dist/quill.js` with `replacement_node_modules/quill/dist/quill.js` after npm install.

### State Management

Redux store in `redux/store.js` (~116k lines) with actions in `redux/actions.js` (~63k lines). Uses `@manaflair/redux-batch` for batched updates.

### Firebase Functions

Located in `functions/`. Uses Firebase Functions v2 syntax:

-   `onDocumentCreated`, `onDocumentUpdated`, `onDocumentDeleted` for Firestore triggers
-   `onSchedule` for scheduled functions
-   `onCall`, `onRequest` for HTTP functions

**Important**: Cloud Functions cannot import non-cloud function modules directly. Keep function code self-contained or use shared helpers within `functions/`.

## Development Guidelines

### Localization

Always consider i18n. Translations in `i18n/translations/` (en.json, de.json, es.json). Use TranslationService for new strings.

### Modals and Popups

Handle event propagation carefully. Set proper z-index and container `<div>` elements.

### Code Style

-   Prettier enforces formatting (4-space indent, single quotes, trailing commas)
-   PascalCase for components (`ProjectDetailedView.js`)
-   camelCase for hooks/helpers (`useComments.js`, `taskActions.js`)
-   Husky runs `pretty-quick --staged` on commit

### Testing

-   Jest with React Native preset and JSDOM environment
-   Tests in `__tests__/` mirror component structure
-   Firebase mocks in `__mocks__/`
-   Maintain 10% coverage thresholds
-   Many tests fail due to native module mocking issues (ExpoLocalization, etc.) - this is a known limitation

### Verifying Code Changes

To verify syntax and compilation without running the full test suite:

```bash
# Start Metro bundler - this will catch syntax errors and import issues
npm run start-clean

# If Metro starts successfully without errors, the code compiles correctly
# Look for "Running Metro Bundler on port 8081" message
```

Note: Standard syntax checkers like `acorn` may fail on modern JavaScript features (optional chaining `?.`, nullish coalescing `??`) that are fully supported by the project's Babel/Metro configuration.

### Environment Configuration

-   `.env` - Current environment variables
-   `envs/env.develop`, `envs/env.master` - Environment-specific configs
-   `env_functions.json`, `env_functions_dev.json`, `env_functions_master.json` - Function configs
-   Service accounts: `serviceAccountKey.json`, `serv_account_key_develop.json`, `serv_account_key_master.json`

### External Services

-   **Algolia**: Search and user mentions
-   **Mollie**: Premium payments
-   **Google Calendar**: Task calendar sync
-   **Sentry**: Error monitoring
-   **SendinBlue/Brevo**: Transactional emails
-   **OpenAI/Perplexity**: AI Assistant features
