#!/usr/bin/env node

// Binds every stored assistant MCP credential (assistants/{projectId}/mcpSecrets/{assistantId}__{serverId})
// to the server URL it was created for, by writing `boundUrl` on it (security audit 2026-11).
//
// Since the audit fix, a run only sends a stored credential to the exact URL in its `boundUrl`, and
// a credential WITHOUT one is refused (functions/MCP/mcpAssistantConnect.js getValidMcpSecret). New
// connections get `boundUrl` when they are made; this script binds the ones that existed before.
// Run it right after the Functions deploy: until it runs, every MCP server with a bearer or OAuth
// credential reports that it has to be reconnected.
//
// Which URL a credential is bound to (resolveLegacyMcpCredentialBinding):
//   - an OAuth credential carries the record written at connect time, `oauthContext.resource`; the
//     server URL currently configured on the assistant is bound only when it is on that origin
//     (source "oauth_resource"), otherwise the credential is left unbound and must be reconnected;
//   - a bearer credential carries no such record, so the configured URL is bound
//     (source "assistant_config"). That URL is member-writable, so REVIEW the printed list before
//     running with --execute: an address you do not recognise means the server must be reconnected
//     instead (delete it from the list by disconnecting it in the assistant settings).
// Credentials whose assistant entry is missing are left unbound and listed.
//
// Usage:
//   node migration/bindMcpCredentialsToServerUrl.js --firebase-project-id=<gcp-project-id>            (dry run)
//   node migration/bindMcpCredentialsToServerUrl.js --firebase-project-id=<gcp-project-id> --execute  (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS). The script never prints a token.

const admin = require('../functions/node_modules/firebase-admin')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

// assistants/{projectId}/mcpSecrets/{assistantId}__{serverId}
function parseSecretPath(path) {
    const segments = String(path || '').split('/')
    if (segments.length !== 4 || segments[0] !== 'assistants' || segments[2] !== 'mcpSecrets') return null
    const separator = segments[3].indexOf('__')
    if (separator <= 0) return null
    return {
        projectId: segments[1],
        assistantId: segments[3].slice(0, separator),
        serverId: segments[3].slice(separator + 2),
    }
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exitCode = 1
        return
    }
    const dryRun = !process.argv.includes('--execute')

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()
    const { resolveLegacyMcpCredentialBinding } = require('../functions/MCP/mcpAssistantConnect')

    console.log('MCP credential binding starting', { firebaseProjectId, dryRun })

    const totals = { scanned: 0, alreadyBound: 0, bound: 0, reconnect: 0 }
    const snapshot = await db.collectionGroup('mcpSecrets').get()
    const assistantCache = new Map()

    for (const doc of snapshot.docs) {
        const location = parseSecretPath(doc.ref.path)
        if (!location) continue
        totals.scanned++
        const secret = doc.data() || {}

        const assistantPath = `assistants/${location.projectId}/items/${location.assistantId}`
        if (!assistantCache.has(assistantPath)) {
            const assistantDoc = await db.doc(assistantPath).get()
            assistantCache.set(assistantPath, assistantDoc.exists ? assistantDoc.data() || {} : null)
        }
        const assistant = assistantCache.get(assistantPath)
        const servers = Array.isArray(assistant?.mcpServers) ? assistant.mcpServers : []
        const server = servers.find(entry => entry && entry.id === location.serverId) || null

        const decision = resolveLegacyMcpCredentialBinding({ secret, server })
        const line = {
            projectId: location.projectId,
            assistantId: location.assistantId,
            serverId: location.serverId,
            label: server?.label || null,
            authType: secret.authType || server?.authType || null,
        }

        if (decision.action === 'already_bound') {
            totals.alreadyBound++
            continue
        }
        if (decision.action === 'reconnect') {
            totals.reconnect++
            console.log('  LEAVE UNBOUND (reconnect needed)', { ...line, reason: decision.reason, ...decision })
            continue
        }

        totals.bound++
        console.log(`  ${dryRun ? 'WOULD BIND' : 'BIND'}`, {
            ...line,
            boundUrl: decision.boundUrl,
            source: decision.source,
        })
        if (!dryRun) {
            await doc.ref.set(
                { boundUrl: decision.boundUrl, boundUrlSource: `migration:${decision.source}`, boundUrlAt: Date.now() },
                { merge: true }
            )
        }
    }

    console.log('MCP credential binding completed', { ...totals, dryRun })
    if (dryRun) {
        console.log(
            `No writes were made. ${totals.bound} credential(s) would be bound. Review the list, then re-run with --execute.`
        )
    }
}

main().catch(error => {
    console.error('MCP credential binding failed', error)
    process.exitCode = 1
})
