# GEMINI.md

## Project Overview

This repository contains the Alldone app, a full-stack application built with React Native for the frontend and Google Cloud Functions for the backend. The app utilizes Firebase for authentication, real-time database, and storage. It also integrates with several external services, including Algolia for search, Sentry for error monitoring, and others.

## Building and Running

### Prerequisites

-   Node.js v14.21.3
-   npm v6.14.18
-   expo-cli v6.1.0
-   firebase-tools v13.29.3

### Scripts

-   **`npm start`**: Starts the Metro Bundler.
-   **`npm run android`**: Runs the app on an Android emulator or connected device.
-   **`npm run ios`**: Runs the app on an iOS simulator or connected device.
-   **`npm run web`**: Runs the app in a web browser.
-   **`npm test`**: Runs the test suite using Jest.
-   **`npm run format-code`**: Formats the code using Prettier.

## Development Conventions

-   The project uses Prettier for code formatting.
-   The project has a comprehensive test suite using Jest.
-   The project uses GitLab CI/CD for continuous integration and deployment.
-   The project has a `replacement_node_modules` directory, which contains a modified version of the Quill library. After installing the dependencies, the modified file needs to be copied to the `node_modules` directory.
