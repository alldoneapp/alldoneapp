'use strict'

const admin = require('firebase-admin')
const { PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const { calculateGoldCostFromTokens } = require('../Assistant/assistantHelper')
const { deductGold } = require('../Gold/goldHelper')
const { classifyCalendarEventProject } = require('./calendarProjectClassifier')
const {
    buildCalendarProjectDefinitions,
    loadActiveProjectsForCalendarRouting,
    loadCalendarProjectRoutingConfig,
} = require('./calendarProjectRoutingConfig')

const CALENDAR_PROJECT_ROUTING_MIN_GOLD_TO_CLASSIFY = 1

function logRouting(message, context = {}) {
    console.log('[calendarProjectRouting]', message, context)
}

async function routeCalendarEventsToProjects({
    userId,
    syncProjectId,
    userData = {},
    events = [],
    calendarEmail = '',
}) {
    if (!userId || !syncProjectId || !Array.isArray(events) || events.length === 0) return {}

    const { config } = await loadCalendarProjectRoutingConfig(userId, syncProjectId, calendarEmail)
    if (!config.enabled) return {}

    if (userData?.premium?.status !== PLAN_STATUS_PREMIUM) {
        logRouting('Skipping routing because premium is required', { userId, syncProjectId })
        return {}
    }

    const activeProjects = await loadActiveProjectsForCalendarRouting(userData)
    const projectDefinitions = buildCalendarProjectDefinitions(activeProjects)
    if (projectDefinitions.length === 0) {
        logRouting('Skipping routing because no active projects were found', { userId, syncProjectId })
        return {}
    }

    const targetProjectIdsByEventId = {}

    for (const event of events) {
        if (!event?.id) continue

        try {
            const userSnapshot = await admin.firestore().collection('users').doc(userId).get()
            const currentGold = Number(userSnapshot.data()?.gold) || 0
            if (currentGold < CALENDAR_PROJECT_ROUTING_MIN_GOLD_TO_CLASSIFY) {
                logRouting('Skipping event because user has insufficient gold', {
                    userId,
                    syncProjectId,
                    eventId: event.id,
                    currentGold,
                })
                continue
            }

            const classifierResult = await classifyCalendarEventProject({
                config,
                event,
                projectDefinitions,
                calendarEmail,
            })

            const tokenUsage = classifierResult?.usage || null
            const estimatedNormalGoldCost = tokenUsage?.totalTokens
                ? calculateGoldCostFromTokens(tokenUsage.totalTokens, config.model)
                : 0
            const goldToCharge = Math.max(estimatedNormalGoldCost, CALENDAR_PROJECT_ROUTING_MIN_GOLD_TO_CLASSIFY)

            const chargeResult = await deductGold(userId, goldToCharge, {
                source: 'calendar_project_routing',
                projectId: syncProjectId,
                objectId: event.id,
                channel: 'calendar',
            })

            if (!chargeResult?.success) {
                logRouting('Unable to deduct routing gold cost', {
                    userId,
                    syncProjectId,
                    eventId: event.id,
                    goldToCharge,
                    currentGold: chargeResult?.currentGold ?? null,
                })
                continue
            }

            logRouting('Classified calendar event', {
                userId,
                syncProjectId,
                eventId: event.id,
                matched: classifierResult.matched,
                projectId: classifierResult.projectId || null,
                confidence: classifierResult.confidence,
                reasoning: classifierResult.reasoning,
                tokenUsage,
                goldSpent: goldToCharge,
            })

            if (classifierResult.matched && classifierResult.projectId) {
                targetProjectIdsByEventId[event.id] = classifierResult.projectId
            }
        } catch (error) {
            logRouting('Failed routing calendar event; falling back to connected project', {
                userId,
                syncProjectId,
                eventId: event.id,
                error: error.message,
            })
        }
    }

    return targetProjectIdsByEventId
}

module.exports = {
    CALENDAR_PROJECT_ROUTING_MIN_GOLD_TO_CLASSIFY,
    routeCalendarEventsToProjects,
}
