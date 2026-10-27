# artifacts.alldone.app

The Firebase Hosting site `alldone-artifacts` (production project `alldonealeph`) that serves
artifacts' public links (`https://artifacts.alldone.app/{token}/`). It holds no app code: every
request except `robots.txt` is rewritten to the `serveArtifact` function, which resolves the token
and serves the file sandboxed (`functions/Artifacts/serveArtifact.js`).

It is a site of its own on purpose. An HTML artifact is code; on the app's site (my.alldone.app) it
would run with the viewer's Firebase session. Never add this rewrite to the root `firebase.json`,
and never connect an app domain to this site.

The config rarely changes and is not deployed by CI. One-time setup, then deploy by hand:

```
firebase hosting:sites:create alldone-artifacts --project alldonealeph
firebase deploy --only hosting --config hosting/artifacts/firebase.json --project alldonealeph
```

Then add `artifacts.alldone.app` as a custom domain of the site (Firebase console → Hosting →
alldone-artifacts → Add custom domain) and create the DNS records it asks for in Squarespace
Domains (alldone.app). Staging has no such site: there public links use serveArtifact's own URL
(`ARTIFACT_PUBLIC_HOSTS` in `functions/Artifacts/artifactModel.js`).

The web app shows `artifacts.alldone.app` links as soon as it is deployed, so the domain must serve
before the change reaches production.
