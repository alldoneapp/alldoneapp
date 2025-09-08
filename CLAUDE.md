# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alldone is a comprehensive React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. The app runs on mobile (iOS/Android) and web with shared codebase.

## Development Commands

```bash
# Development
npm start                    # Start development server
npm run web                  # Start web version
npm run android             # Run on Android
npm run ios                 # Run on iOS
npm run start-clean         # Start with cache reset
firebase emulators:start --only functions --inspect-functions #start firebase functions emulator wiht auto-check for updates

# Testing
npm test                    # Run Jest tests
npm run coverage           # Generate test coverage
npm run update-snapshots   # Update Jest snapshots

# Build & Deploy
npm run build-web          # Build for web production
npm run format-code        # Format code with Prettier
```

## Architecture Overview

### Core Technologies

-   **React Native (0.61.4)** with Expo for cross-platform development
-   **Firebase** (Firestore, Auth, Functions, Storage) for backend services
-   **Redux** with custom batching for state management
-   **Custom URL System** for navigation and deep linking

### Key Architectural Patterns

**Feature-Based Components**: Components organized by domain (`TaskListView/`, `GoalsView/`, `NotesView/`, etc.) with dedicated DetailedView components for each entity type.

**Backend Bridge Pattern**: `utils/BackendBridge.js` abstracts Firebase operations with feature-specific backend modules in `utils/backends/`.

**Custom URL System**: Sophisticated routing in `URLSystem/` with dedicated triggers and constants for each feature, supporting deep linking and history management.

**Real-time Collaboration**: Quill editor with Yjs for collaborative rich-text editing, custom modifications in QuillHelper.js.

### State Management

Redux store manages complex state tree with 2700+ lines of actions covering:

-   Multi-tenant project data (tasks, goals, notes, contacts)
-   Real-time feeds and notifications
-   UI state (modals, navigation, responsive breakpoints)
-   User authentication and project membership

### Firebase Integration

**Cloud Functions** (`functions/` directory):

-   Event-driven functions (onCreate/onUpdate/onDelete) for each entity
-   Scheduled functions for recurring tasks and notifications
-   Email template system with SendinBlue integration
-   AI Assistant integration with OpenAI/Perplexity

**Real-time Features**:

-   Firestore listeners with custom watchers
-   Live collaboration using Yjs for notes
-   Activity feeds with automatic generation
-   Push notifications via Firebase Messaging

## Important Development Notes

### Component Patterns

-   Use existing UI components from `UIComponents/` and `UIControls/`
-   Follow DetailedView pattern for entity screens
-   Implement proper navigation with URLSystem triggers
-   Add proper tags using components from `Tags/` directory

### Backend Development

-   Firebase Functions use environment-specific configs (develop/master)
-   Use batch operations for complex Firestore updates
-   Follow existing feed generation patterns in `functions/Feeds/`
-   Implement proper error handling and logging

### Testing

-   Jest snapshots extensively used - update with `npm run update-snapshots`
-   Mock Firebase in `__mocks__/` directory
-   Test files follow component structure in `__tests__/`

### External Integrations

-   **Algolia**: Global search functionality
-   **Mollie**: Payment processing for premium features
-   **Google Calendar**: Calendar integration for tasks
-   **Sentry**: Error monitoring and logging

### Multi-platform Considerations

-   Responsive design with breakpoint management
-   Platform-specific optimizations in MyPlatform.js
-   Web-specific configurations in web/ directory
