'use strict'

const admin = require('firebase-admin')

const { CONNECTION_SERVICE_CALENDAR } = require('./providerConnections')

// How many recent audit messages to carry over — covers the 30-day dedupe lookback,
// the needs-reply window (100), and the modal reasoning join for recent mail.
const AUDIT_MESSAGES_TO_COPY = 300

function privateDocRef(userId, docId) {
    return admin.firestore().collection('users').doc(userId).collection('private').doc(docId)
}

async function copyDocIfMissing(sourceRef, targetRef, extraFields = {}) {
    const [sourceDoc, targetDoc] = await Promise.all([sourceRef.get(), targetRef.get()])
    if (!sourceDoc.exists || targetDoc.exists) return false
    await targetRef.set({ ...sourceDoc.data(), ...extraFields })
    return true
}

// Copies the project-keyed private docs of one account-level connection to their
// connection-keyed successors. Copies never overwrite existing connection-keyed docs
// (idempotent), and the old labeling config is disabled + stamped with `migratedTo`
// in the same pass so the scheduled scanner cannot double-process.
//
// connection: { connectionId, service, provider, emailAddress, defaultProjectId }
// sourceProjectIds: legacy apisConnected project ids this account was connected under.
async function migrateConnectionDocs(userId, connection, sourceProjectIds = []) {
    const results = {
        tokenCopied: false,
        labelingConfigCopied: false,
        labelingStateCopied: false,
        auditMessagesCopied: 0,
        routingConfigCopied: false,
    }
    const { connectionId, service, provider, defaultProjectId } = connection
    const projectIds = [...new Set([defaultProjectId, ...sourceProjectIds].filter(Boolean))]

    const isCalendar = service === CONNECTION_SERVICE_CALENDAR
    const legacyGoogleService = isCalendar ? 'calendar' : 'gmail'
    const legacyMicrosoftService = isCalendar ? 'calendar' : 'email'

    for (const projectId of projectIds) {
        // 1. OAuth token doc
        if (!results.tokenCopied) {
            const sourceTokenRef =
                provider === 'microsoft'
                    ? privateDocRef(userId, `microsoftAuth_${projectId}_${legacyMicrosoftService}`)
                    : privateDocRef(userId, `googleAuth_${projectId}_${legacyGoogleService}`)
            const targetTokenRef =
                provider === 'microsoft'
                    ? privateDocRef(userId, `microsoftAuth_${connectionId}`)
                    : privateDocRef(userId, `googleAuth_${connectionId}`)
            results.tokenCopied = await copyDocIfMissing(sourceTokenRef, targetTokenRef, { connectionId })
        }

        if (isCalendar) {
            // 2. Calendar project routing config
            if (!results.routingConfigCopied) {
                results.routingConfigCopied = await copyDocIfMissing(
                    privateDocRef(userId, `calendarProjectRouting_${projectId}`),
                    privateDocRef(userId, `calendarProjectRouting_${connectionId}`),
                    { connectionId }
                )
            }
            continue
        }

        // 2. Gmail labeling config — the old doc is disabled + stamped so the scheduled
        // collectionGroup scan skips it (double-processing guard).
        const sourceConfigRef = privateDocRef(userId, `gmailLabeling_${projectId}`)
        const sourceConfigDoc = await sourceConfigRef.get()
        if (sourceConfigDoc.exists) {
            if (!results.labelingConfigCopied) {
                results.labelingConfigCopied = await copyDocIfMissing(
                    sourceConfigRef,
                    privateDocRef(userId, `gmailLabeling_${connectionId}`),
                    { connectionId, projectId: defaultProjectId || projectId }
                )
            }
            if (!sourceConfigDoc.data()?.migratedTo) {
                await sourceConfigRef.set({ enabled: false, migratedTo: connectionId }, { merge: true })
            }
        }

        // 3. Gmail labeling state (incl. lastHistoryId so incremental sync continues)
        // + the most recent audit messages.
        const sourceStateRef = privateDocRef(userId, `gmailLabelingState_${projectId}`)
        const targetStateRef = privateDocRef(userId, `gmailLabelingState_${connectionId}`)
        if (!results.labelingStateCopied) {
            results.labelingStateCopied = await copyDocIfMissing(sourceStateRef, targetStateRef, {
                connectionId,
            })
            if (results.labelingStateCopied) {
                const messagesSnapshot = await sourceStateRef
                    .collection('messages')
                    .orderBy('processedAt', 'desc')
                    .limit(AUDIT_MESSAGES_TO_COPY)
                    .get()
                const writer = admin.firestore().bulkWriter()
                messagesSnapshot.docs.forEach(messageDoc => {
                    writer.set(targetStateRef.collection('messages').doc(messageDoc.id), messageDoc.data())
                })
                await writer.close()
                results.auditMessagesCopied = messagesSnapshot.size
            }
        }
    }

    return results
}

module.exports = {
    migrateConnectionDocs,
    AUDIT_MESSAGES_TO_COPY,
}
