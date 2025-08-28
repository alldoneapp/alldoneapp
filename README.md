# Alldone App

This repository contains both the frontend and backend (Google Cloud Functions) code for the **Alldone** app.

## 1. Global Dependencies

Ensure you have the following dependencies installed with the specified versions:

-   **Node.js** v14.21.3  
    (We recommend using a Node version manager like `nvm`.)
-   **npm** v6.14.18  
    (Normally installed along with Node.js.)
-   **expo-cli** v6.1.0  
    (`npm install -g expo-cli@6.1.0`)
-   **firebase-tools** v13.29.3  
    (`npm install -g firebase-tools@13.29.3`)

## 2. CI/CD

The project is configured for **GitLab CI/CD** using the `.gitlab-ci.yml` file.

If you want to use a different CI/CD platform (such as GitHub Actions, Bitbucket Pipelines, or CircleCI), you will need to create your own configuration files. You can refer to the existing setup as a starting point, but some adjustments may be necessary.

## 3. External Dependencies

> **Note:**  
> If you are contributing to the main Alldone app, you can skip this section.  
> If you plan to deploy your own instance of the app, please continue reading.

The Alldone app relies on several external services. To run your own instance, you must create accounts and configure these services as outlined below.

### Algolia

Alldone uses **Algolia** for search functionality and user mentions.

You can create an account at [Algolia](https://www.algolia.com/).  
Algolia offers a free tier with limited resources, but for production, we recommend the **Pay-as-you-go** plan.

---

#### Accounts

You should create **two separate accounts**, one for staging and other for production

---

#### Local Environment Setup

To run the app locally, add the following variables:

-   `ALGOLIA_APP_ID`
-   `ALGOLIA_SEARCH_ONLY_API_KEY`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

Add these variables to GitLab CI/CD:

-   `ALGOLIA_APP_ID_DEV`
-   `ALGOLIA_SEARCH_ONLY_API_KEY_DEV`
-   `ALGOLIA_APP_ID_PROD`
-   `ALGOLIA_SEARCH_ONLY_API_KEY_PROD`

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following in each environment:

-   `ALGOLIA_APP_ID`
-   `ALGOLIA_ADMIN_API_KEY`

Add these to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

> **Note:** The `.env` file must match the currently active environment.

### Analytics

Alldone uses **Google Analytics** and **Google Ads** for tracking, as well as **Google Tag Manager** for event and conversion management.

---

#### Local Environment Setup

Add the following variables:

-   `GOOGLE_ANALYTICS_KEY`
-   `GOOGLE_ADS_GUIDE_CONVERSION_TAG`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration (Staging & Production)

Add these variables to GitLab CI/CD:

-   `GOOGLE_ANALYTICS_KEY_PROD`
-   `GOOGLE_ADS_GUIDE_CONVERSION_TAG_PROD`

---

#### Functions Environment Setup (Local, Staging, Production)

To support analytics tracking in serverless functions, include:

-   `GOOGLE_ANALYTICS_KEY`
-   `GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET`

Add these to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

---

#### Service Worker

To enable analytics tracking in Firebase Messaging, set:

-   `measurementId`

Add it to:

-   `firebase-messaging-sw.js`

---

#### Google Tag Manager Setup

To integrate **Google Tag Manager**, add the tag ID in the following format:

```html
<!-- Script -->
gtmFn(window, document, 'script', 'dataLayer', '[GTM-ID]')

<!-- Noscript -->
<noscript
    ><iframe
        src="https://www.googletagmanager.com/ns.html?id=GTM-THM5BX5"
        height="0"
        width="0"
        style="display:none;visibility:hidden"
    ></iframe
></noscript>

Where GTM-ID is your Google Tag Manager id
```

### Firebase

Alldone uses **Firebase** for authentication, real-time database access, storage and other functionalities.

You can manage your project at [Firebase Console](https://console.firebase.google.com/).

---

#### Local Environment Setup

To run the app locally, add the following variables:

-   `GOOGLE_FIREBASE_WEB_CLIENT_ID`
-   `GOOGLE_FIREBASE_WEB_API_KEY`
-   `GOOGLE_FIREBASE_DEPLOY_TOKEN`
-   `GOOGLE_FIREBASE_WEB_APP_ID`
-   `GOOGLE_FIREBASE_WEB_AUTH_DOMAIN`
-   `GOOGLE_FIREBASE_WEB_DATABASE_URL`
-   `GOOGLE_FIREBASE_STORAGE_BUCKET`
-   `GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET`
-   `GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID`
-   `GOOGLE_FIREBASE_WEB_PROJECT_ID`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

Add these variables to GitLab CI/CD:

-   `GOOGLE_FIREBASE_WEB_CLIENT_ID_DEV`
-   `GOOGLE_FIREBASE_WEB_CLIENT_ID_PROD`
-   `GOOGLE_FIREBASE_WEB_API_KEY_DEV`
-   `GOOGLE_FIREBASE_WEB_API_KEY_PROD`
-   `GOOGLE_FIREBASE_DEPLOY_TOKEN`
-   `GOOGLE_FIREBASE_WEB_APP_ID_DEV`
-   `GOOGLE_FIREBASE_WEB_APP_ID_PROD`
-   `GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_DEV`
-   `GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_PROD`
-   `GOOGLE_FIREBASE_WEB_DATABASE_URL_DEV`
-   `GOOGLE_FIREBASE_WEB_DATABASE_URL_PROD`
-   `GOOGLE_FIREBASE_STORAGE_BUCKET_DEV`
-   `GOOGLE_FIREBASE_STORAGE_BUCKET_PROD`
-   `GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET_DEV`
-   `GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET_PROD`
-   `GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_DEV`
-   `GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_PROD`
-   `GOOGLE_FIREBASE_WEB_PROJECT_ID_DEV`
-   `GOOGLE_FIREBASE_WEB_PROJECT_ID_PROD`

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following in each environment:

-   `GOOGLE_FIREBASE_WEB_CLIENT_ID`
-   `GOOGLE_FIREBASE_DEPLOY_TOKEN`
-   `GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET`

Add these to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

---

#### Service Worker Setup

In the `firebase-messaging-sw.js` file, include:

-   `apiKey`
-   `appId`
-   `authDomain`
-   `databaseURL`
-   `messagingSenderId`
-   `storageBucket`

---

#### Google Services Configuration

In the `google-services.json` file, include:

-   `client_id`
-   `firebase_url`
-   `project_number`

---

### SendinBlue

Alldone uses **SendinBlue** for transactional emails and marketing communication services.

You can learn more at [SendinBlue](https://www.sendinblue.com/).

---

#### Local Environment Setup

To run the app locally with SendinBlue, add the following variables:

-   `SIB_API_KEY`
-   `SIB_MARKETING_SERVICE_LIST`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variables to GitLab CI/CD:

-   `SIB_API_KEY`
-   `SIB_MARKETING_SERVICE_LIST_DEV`
-   `SIB_MARKETING_SERVICE_LIST_PROD`

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following in each environment:

-   `SIB_API_KEY`

Add this to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

### Sentry

Alldone uses **Sentry** for error monitoring and performance tracking.

You can learn more at [Sentry](https://sentry.io/).

---

#### Local Environment Setup

To run the app locally with Sentry, add the following variable:

-   `SENTRY_DSN`

Add this to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variable to GitLab CI/CD:

-   `SENTRY_DSN`

---

### OpenAI

Alldone uses **OpenAI** for AI-powered features and automation.

You can learn more at [OpenAI](https://openai.com/).

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following variable in each environment:

-   `OPEN_AI_KEY`

Add this to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

---

### Perplexity

Alldone integrates **Perplexity** for advanced AI query capabilities.

Learn more at [Perplexity](https://www.perplexity.ai/).

---

#### Local Environment Setup

To run the app locally with Perplexity, add the following variable:

-   `PERPLEXITY_API_KEY`

Add this to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variable to GitLab CI/CD:

-   `PERPLEXITY_API_KEY`

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following variable:

-   `PERPLEXITY_API_KEY`

Add this to:

-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

---

### Quill Editor

Alldone uses the **Quill editor** for creating notes and tasks, enabling rich text and embedded content.

---

#### Custom Modifications

We’ve made custom modifications to the Quill library to support our specific use cases.

After installing Quill, replace the default file with the modified version:

-   **Copy:** `replacement_node_modules/quill/dist/quill.js`
-   **Replace:** `node_modules/quill/dist/quill.js`

---

#### Collaboration Support

Quill supports real-time collaborative editing, allowing multiple users to edit a note simultaneously.

To enable collaboration, you can use one of the following public signaling servers:

-   `wss://signaling.yjs.dev`
-   `wss://y-webrtc-signaling-eu.herokuapp.com`
-   `wss://y-webrtc-signaling-us.herokuapp.com`

> ⚠️ These public servers may become unavailable. For long-term use, we recommend hosting your own.

You can run your own signaling server. We provide a reference implementation here:  
[Collaboration Server Repo](https://github.com/kwkrass/alldonecollabserver)

This implementation is designed for Google App Engine but can be adapted for other environments.  
If using your own server, update the environment configurations accordingly.

---

#### Local Environment Setup

To support collaboration locally, add the following variable:

-   `NOTES_COLLABORATION_SERVER`

Add this to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration (Staging & Production)

For staging and production environments, add the following variable to **GitLab CI/CD**:

-   `NOTES_COLLABORATION_SERVER`

### GitHub

Alldone uses a repository mirror to **GitHub** to provide free public access to the codebase.  
If you're setting up your own instance, you likely won't need this functionality.  
However, if you wish to replicate your repository to GitHub, the integration is already configured and ready to use.

You can learn more at [GitHub](https://github.com/).

---

#### Local Environment Setup

To run the app locally with GitHub integration, add the following variables:

-   `GITHUB_TOKEN`
-   `GITHUB_USER`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variables to GitLab CI/CD:

-   `GITHUB_TOKEN`
-   `GITHUB_USER`

---

### Ipregistry

Alldone uses **ipregistry** to handle geolocation.

You can learn more at [Ipregistry](https://ipregistry.co/).

---

#### Local Environment Setup

To run the app locally, add the following variables:

-   `IP_REGISTRY_API_KEY`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variables to GitLab CI/CD:

-   `IP_REGISTRY_API_KEY`

---

### Giphy

Alldone uses **Giphy** to handle gif animations.

You can learn more at [Giphy](https://giphy.com/).

---

#### Local Environment Setup

To run the app locally, add the following variables:

-   `GIPHY_API_KEY`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

For staging and production environments, add the following variables to GitLab CI/CD:

-   `GIPHY_API_KEY_DEV`
-   `GIPHY_API_KEY_PROD`

---

### Mollie Integration

Alldone uses **Mollie** to handle premium subscription payments.

---

#### Licensing and Commercial Use

Alldone is free to use under a non-commercial license.  
If you wish to use Alldone for **commercial purposes**, you must first contact us to reach an agreement.

If granted permission for commercial use, you can use the current premium payment system. You’ll need to configure the Mollie integration as described below.

---

#### Functions Environment Setup (Local, Staging, Production)

To enable Mollie in functions, add the following environment variable:

-   `MOLLIE_API_KEY`
-   `MOLLIE_WEBHOOK`
-   `MOLLIE_SEND_MONTHLY_INVOICE`

Add this to:

-   `.env`
-   `env_functions.json`
-   `env_functions_master.json`
-   `env_functions_dev.json`

---

### Using Alldone Without Premium Subscriptions

If you're not using Alldone commercially or prefer not to integrate payments, you can disable premium features:

#### 1. Replace Premium Tab

Replace the `PremiumTab` with a placeholder tab.

> ⚠️ We **do not recommend removing it**, as some links may point to it, which could cause runtime errors. This is why you need to replace the tab only.

You’ll find the component here:

-   `components/Premium/PremiumTab.js`
-   Referenced in: `SettingsView` component

---

#### 2. Change Default User Plan

To make all users premium by default:

-   Locate the `getNewDefaultUser` function.
-   Update the `premium` entry:

```js
premium: { status: PLAN_STATUS_PREMIUM },

#### Alternative: Manually Set Premium Users and Remove Cloud Functions

Alternatively, you can manually update specific users in the database to have premium access:

- Go to the `users` collection.
- Set the field `premium.status` to `premium` for any user you want to treat as premium.

---

You can also remove premium-related **Google Cloud Functions** to reduce costs.
> ⚠️ This is optional and should only be done if you’ve replaced or disabled the `PremiumTab`.

The following functions can be safely removed:

- `updateCreditCardNumberSecondGen`
- `createCompanySubscriptionSecondGen`
- `removeUserFromSubscriptionSecondGen`
- `addedPaidUsersToSubscriptionSecondGen`
- `addedPaidUsersWhenActivateSubscriptionSecondGen`
- `removePaidUsersFromSubscriptionSecondGen`
- `addedUsersToSubscriptionSecondGen`
- `addedUsersWhenActivateSubscriptionSecondGen`
- `cancelSubscriptionSecondGen`
- `webhookSecondGen`
- `webhook`
- `updateMollieSubscription`
- `sendMonthlyInvoiceSecondGen`
- `sendMonthlyInvoice`
- `resetUserFreePlanSecondGen`
- `autoCancelSubscriptionsSecondGen`

## 4. Alldone company data

> **Note:**
> If you are contributing to the main Alldone app, you can skip this section.
> If you plan to deploy your own instance of the app, please continue reading.

The codebase includes references to company-specific data related to Alldone.
If you're setting up your own instance, make sure to search for and replace these values with your own company information.

Below is a list of placeholders you should look for and update accordingly:

-   `Karsten`
-   `Wysk`
-   `Karsten@AllDone.app`
-   `karsten@alldone.app`
-   `Kolonnenstr. 8 10827 Berlin`
-   `Alldone GmbH`
-   `HRB 214608B`
-   `30 205 51005`
-   `DE334674051`
-   `CEO Alldone.app`

Be thorough when replacing these values to ensure your deployment is fully customized and legally compliant.

Check the files `.env.alldonealeph` and `.env.alldonestaging`

## 5. Alldone hostings

> **Note:**
> If you are contributing to the main Alldone app, you can skip this section.
> If you plan to deploy your own instance of the app, please continue reading.

The codebase contains links pointing to the official Alldone application.
When deploying your own version, you should update these URLs to reflect your own domain and hosting setup.

Below is a list of placeholders to search for and replace:

-   `https://mystaging.alldone.app`
-   `alldone.app`
-   `https://my.alldone.app/`

Make sure to review all environment files, configuration files, and hardcoded URLs to ensure your deployment points to your own infrastructure.
```

## 6. 🔥 Firestore Database Setup

We use **Firestore** as the primary database. For the initial setup, you'll need to manually add a few entries to Firestore:

### 1. Create the Administrator Role

-   Create a document at the path: `roles/administrator`
-   Inside the document, add a field called `userId` with the ID of the admin user.

> ⚠️ The first time you run **AllDone**, a user document will be automatically created under the `users` collection.  
> You can find the ID of that user and manually set it in the `roles/administrator` document.

You can later update the `userId` to assign administrator rights to a different user if needed.

```

```

## 7. Alldone environments

We have two main environments configured, production and staging.

---

#### Local Environment Setup

To run the app locally, add the following variables:

-   `CURRENT_ENVIORNMENT`
-   `HOSTING_URL`

Add these to:

-   `.env` (current environment)
-   `envs/env.develop`
-   `envs/env.master`

---

#### CI/CD Configuration

Add these variables to GitLab CI/CD:

-   `CURRENT_ENVIORNMENT_DEV`
-   `CURRENT_ENVIORNMENT_PROD`
-   `HOSTING_URL_DEV`
-   `HOSTING_URL_PROD`

---

#### Functions Environment Setup (Local, Staging, Production)

To support functions, include the following in each environment:

-   `CURRENT_ENVIORNMENT`
-   `HOSTING_URL`

Add these to:

-   `.env`
-   `.env.alldonestaging`
-   `.env.alldonealeph`

> **Note:** The `.env` file must match the currently active environment.

## 8. Service Account Configuration

To configure the service accounts for different environments, create the following files in your project directory:

-   `serviceAccountKey.json`
-   `serv_account_key_develop.json`
-   `serv_account_key_master.json`

Each file should contain the following JSON structure:

```json
{
  "type": "",
  "project_id": "",
  "private_key_id": "",
  "private_key": "",
  "client_email": "",
  "client_id": "",
  "auth_uri": "",
  "token_uri": "",
  "auth_provider_x509_cert_url": "",
  "client_x509_cert_url": ""
}

Be sure to fill in the correct credentials for each environment (e.g., development, staging, production).
These credentials are typically generated from your Google Cloud Console when creating a service account key.
```
