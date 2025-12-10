const admin = require('firebase-admin')

const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')

function getBaseUrl() {
    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5000'
    }
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }
    if (!projectId) {
        try {
            projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
        } catch (_) {}
    }
    if (projectId === 'alldonealeph') return 'https://my.alldone.app'
    if (projectId === 'alldonestaging') return 'https://mystaging.alldone.app'
    return 'https://my.alldone.app'
}

async function processWhatsAppNotifications() {
    const db = admin.firestore()
    const docs = (await db.collection('whatsAppNotifications').orderBy('timestamp', 'asc').limit(100).get()).docs

    if (docs.length === 0) return { processed: 0 }

    const service = new TwilioWhatsAppService()
    let processed = 0

    for (const doc of docs) {
        const notif = doc.data()
        const {
            userId,
            userPhone,
            projectId,
            projectName,
            objectId,
            objectName,
            updateText,
            link,
            assistantName,
            openTasksCount,
            isWelcome,
        } = notif

        try {
            // Handle welcome notifications with the dedicated method
            if (isWelcome) {
                await service.sendWelcomeNotification(userPhone)
                await db.doc(`whatsAppNotifications/${doc.id}`).delete()
                processed++
                continue
            }

            let finalProjectName = projectName || 'Project'
            let finalObjectName = objectName || 'Item'
            let finalLink = link

            if (!finalProjectName) {
                try {
                    const pDoc = await db.doc(`projects/${projectId}`).get()
                    finalProjectName = pDoc.exists ? pDoc.data().name || 'Project' : 'Project'
                } catch (_) {}
            }

            if (!finalLink) {
                const base = getBaseUrl()
                finalLink = `${base}/projects/${projectId}/tasks/${objectId}/chat`
            }

            await service.sendNotificationWithTemplate(
                userPhone,
                userId,
                finalProjectName,
                finalObjectName,
                updateText || 'alert time reached',
                finalLink,
                assistantName,
                openTasksCount
            )

            await db.doc(`whatsAppNotifications/${doc.id}`).delete()
            processed++
        } catch (e) {
            console.error('WhatsApp queue: failed to send notification', {
                id: doc.id,
                error: e.message,
            })
            // best-effort: delete to avoid blocking, or keep for retry? Keep for retry → skip delete
        }
    }

    return { processed }
}

module.exports = { processWhatsAppNotifications }
