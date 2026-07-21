#!/usr/bin/env node
/**
 * Compares firestore.indexes.json against the composite indexes and field
 * overrides that are actually live in a Firestore project.
 *
 * Usage:
 *   node ci/check-firestore-indexes.js <projectId> [--strict] [--warn-only]
 *
 * Why this exists: `firebase deploy --only firestore:indexes` treats the file as
 * the desired state. When the file drifts below the live set, a deploy with
 * --force deletes every live index and field override the file omits. This
 * script makes that drift visible before anyone deploys.
 *
 * It relies on `firebase firestore:indexes` emitting exactly the file's shape
 * under the pinned firebase-tools 13.29.3 (trailing `__name__` stripped, no
 * `density`). Newer CLIs keep `__name__` and add `density`; both are normalised
 * away below so the check also works locally on a newer CLI.
 *
 * Exit codes: 0 = in sync, 1 = drift found (unless --warn-only).
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const projectId = args.find(a => !a.startsWith('--'))
const strict = args.includes('--strict')
const warnOnly = args.includes('--warn-only')

if (!projectId) {
    console.error('usage: node ci/check-firestore-indexes.js <projectId> [--strict] [--warn-only]')
    process.exit(2)
}

// Indexes that cannot be represented in firestore.indexes.json, or that are
// provably junk. Ignored unless --strict.
//   - collections named with a Firebase push ID: created by a path-templating
//     bug; the collections hold no documents.
//   - `__name__`-only indexes, which the file format cannot express (and which
//     Firestore already provides implicitly). The pinned CLI reports these with
//     zero fields, newer CLIs with a single `__name__` field.
const PUSH_ID = /^-[A-Za-z0-9_-]{19}$/
const isIgnorable = index => PUSH_ID.test(index.collectionGroup) || index.fields.every(f => f.fieldPath === '__name__')

const repoRoot = path.resolve(__dirname, '..')
const specPath = path.join(repoRoot, 'firestore.indexes.json')
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))

const firebaseArgs = ['firestore:indexes', '--project', projectId]
if (process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN) {
    firebaseArgs.push('--token', process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN)
}

let raw
try {
    raw = execFileSync('firebase', firebaseArgs, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
} catch (e) {
    console.error(`Failed to read live indexes for ${projectId}: ${e.message}`)
    process.exit(2)
}

// The CLI may prefix log lines before the JSON payload.
const jsonStart = raw.indexOf('{')
if (jsonStart < 0) {
    console.error(`Unexpected output from firebase firestore:indexes:\n${raw.slice(0, 500)}`)
    process.exit(2)
}
const live = JSON.parse(raw.slice(jsonStart))

// Normalise an index to a comparable key. A trailing `__name__` is dropped only
// when it matches the direction Firestore implies (that of the last ordered
// field), which is the same rule firebase-tools applies when it re-appends one.
const normaliseFields = fields => {
    const out = fields.map(f => ({ fieldPath: f.fieldPath, order: f.order, arrayConfig: f.arrayConfig }))
    const last = out[out.length - 1]
    if (last && last.fieldPath === '__name__' && out.length > 1) {
        const implied = out.slice(0, -1).reduce((acc, f) => f.order || acc, 'ASCENDING')
        if (last.order === implied) out.pop()
    }
    return out
}

const indexKey = index =>
    JSON.stringify([
        index.collectionGroup,
        index.queryScope,
        normaliseFields(index.fields).map(f => [f.fieldPath, f.order || null, f.arrayConfig || null]),
    ])

const fieldKey = override =>
    JSON.stringify([
        override.collectionGroup,
        override.fieldPath,
        Boolean(override.ttl),
        (override.indexes || []).map(i => i.order || i.arrayConfig).sort(),
    ])

const describe = index =>
    `${index.collectionGroup} [${index.queryScope}] ` +
    normaliseFields(index.fields)
        .map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`)
        .join(', ')

const liveIndexes = strict ? live.indexes : live.indexes.filter(i => !isIgnorable(i))
const liveByKey = new Map(liveIndexes.map(i => [indexKey(i), i]))
const specByKey = new Map(spec.indexes.map(i => [indexKey(i), i]))

const missing = [...specByKey].filter(([k]) => !liveByKey.has(k)).map(([, i]) => i)
const undeclared = [...liveByKey].filter(([k]) => !specByKey.has(k)).map(([, i]) => i)

const liveFields = new Map((live.fieldOverrides || []).map(o => [fieldKey(o), o]))
const specFields = new Map((spec.fieldOverrides || []).map(o => [fieldKey(o), o]))
const missingFields = [...specFields].filter(([k]) => !liveFields.has(k)).map(([, o]) => o)
const undeclaredFields = [...liveFields].filter(([k]) => !specFields.has(k)).map(([, o]) => o)

const ignoredCount = live.indexes.length - liveIndexes.length

console.log(`\nfirestore.indexes.json vs ${projectId}`)
console.log(`  declared: ${spec.indexes.length} indexes, ${(spec.fieldOverrides || []).length} field overrides`)
console.log(`  live:     ${liveIndexes.length} indexes, ${(live.fieldOverrides || []).length} field overrides`)
if (ignoredCount) console.log(`  ignored:  ${ignoredCount} unrepresentable/junk live indexes (use --strict to include)`)

if (missing.length) {
    console.log(`\n  Declared but NOT live - a deploy would CREATE these ${missing.length}:`)
    missing.forEach(i => console.log(`    + ${describe(i)}`))
}
if (missingFields.length) {
    console.log(`\n  Field overrides a deploy would PATCH (${missingFields.length}):`)
    missingFields.forEach(o => console.log(`    ~ ${o.collectionGroup}.${o.fieldPath}`))
}
if (undeclared.length) {
    console.log(`\n  Live but NOT declared - DRIFT; --force would DELETE these ${undeclared.length}:`)
    undeclared.forEach(i => console.log(`    - ${describe(i)}`))
}
if (undeclaredFields.length) {
    console.log(`\n  Live field overrides not declared - --force would DELETE these ${undeclaredFields.length}:`)
    undeclaredFields.forEach(o => console.log(`    - ${o.collectionGroup}.${o.fieldPath}`))
}

const drift = missing.length + undeclared.length + missingFields.length + undeclaredFields.length
if (!drift) {
    console.log('\n  In sync.\n')
    process.exit(0)
}

console.log(
    `\n  ${drift} difference(s). Undeclared entries mean someone created an index outside this file;\n` +
        `  add them here (regenerate with: firebase firestore:indexes --project ${projectId}).\n`
)
process.exit(warnOnly ? 0 : 1)
