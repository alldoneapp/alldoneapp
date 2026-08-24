'use strict'

// Publishes the freshly built web-build/ as its own over-the-air update for
// the iOS Capacitor shell (self-hosted OTA — no external update service).
//
// Runs as part of `web-bundler`'s npm build, AFTER webpack finished, so the
// files it adds are invisible to the workbox InjectManifest precache (which is
// generated during webpack) — the ~50 MB zip must never enter the PWA
// precache. Because the artifacts live INSIDE web-build/, every existing web
// deploy (production, staging live, preview channels) publishes the matching
// OTA bundle with zero pipeline changes, and the deploy-scope markers apply
// unchanged.
//
// Layout produced:
//   web-build/ota-version.json          — identity of THIS build (also zipped,
//                                         so an applied OTA bundle knows itself)
//   web-build/ota/bundle-<sha>.zip      — the whole build, immutable URL
//   web-build/ota/latest.json           — { version, url, channel, builtAt }
//
// channel: 'ci' only when built by CI. Local builds are stamped 'local' and
// utils/shellOtaUpdater.js refuses to auto-update FROM a local build — without
// that, a locally built dev shell would replace itself with the deployed
// staging web the moment it launches.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { createZip } = require('./lib/simpleZip')

const repoRoot = path.resolve(__dirname, '..')
const webBuild = path.join(repoRoot, 'web-build')

const resolveVersion = () => {
    if (process.env.CI_COMMIT_SHA) return process.env.CI_COMMIT_SHA
    try {
        return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim()
    } catch (error) {
        return `unknown-${Date.now()}`
    }
}

const collectFiles = (dir, base = '') => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name
        if (rel === 'ota') continue // never zip the ota channel into itself
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...collectFiles(full, rel))
        else if (entry.isFile()) out.push({ name: rel, data: fs.readFileSync(full) })
    }
    return out
}

const main = () => {
    if (!fs.existsSync(path.join(webBuild, 'index.html'))) {
        console.error('[ota] web-build/index.html not found — run the web build first')
        process.exit(1)
    }

    const version = resolveVersion()
    const channel = process.env.OTA_CHANNEL || (process.env.CI ? 'ci' : 'local')
    const builtAt = new Date().toISOString()

    const versionInfo = { version, channel, builtAt }
    fs.writeFileSync(path.join(webBuild, 'ota-version.json'), JSON.stringify(versionInfo, null, 2) + '\n')

    const files = collectFiles(webBuild)
    const zip = createZip(files)

    const otaDir = path.join(webBuild, 'ota')
    fs.mkdirSync(otaDir, { recursive: true })
    const zipName = `bundle-${version}.zip`
    fs.writeFileSync(path.join(otaDir, zipName), zip)
    fs.writeFileSync(
        path.join(otaDir, 'latest.json'),
        JSON.stringify({ version, channel, builtAt, url: `/ota/${zipName}` }, null, 2) + '\n'
    )

    console.log(
        `[ota] bundle published: version ${version.slice(0, 12)} channel ${channel} ` +
            `files ${files.length} zip ${(zip.length / 1024 / 1024).toFixed(1)} MB`
    )
}

main()
