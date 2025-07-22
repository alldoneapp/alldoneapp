'use strict'
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { log } = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const admin = require('firebase-admin')
const firebaseConfig = require('./firebaseConfig.js')

firebaseConfig.init(admin)

//PAYMENT AND PREMIUM

exports.updateCreditCardNumberSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (auth) {
            const { updateCreditCardNumber } = require('./Payment/SubscriptionsActions')
            const { userPayingId, urlOrigin } = data
            return await updateCreditCardNumber(userPayingId, urlOrigin)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createCompanySubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (auth) {
            const { createCompanySubscription } = require('./Payment/SubscriptionsActions')
            const {
                customerId,
                userId,
                userName,
                userEmail,
                selectedUserIds,
                companyData,
                paymentMethod,
                urlOrigin,
            } = data

            return await createCompanySubscription(
                customerId,
                userId,
                userName,
                userEmail,
                selectedUserIds,
                companyData,
                paymentMethod,
                urlOrigin
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removeUserFromSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removePaidUsersFromSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, userId } = data
            return await removePaidUsersFromSubscription(userPayingId, [userId])
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedPaidUsersToSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedPaidUsersToSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, paidAddedUserIds } = data
            return await addedPaidUsersToSubscription(userPayingId, paidAddedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedPaidUsersWhenActivateSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedPaidUsersWhenActivateSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, paidAddedUserIds } = data
            return await addedPaidUsersWhenActivateSubscription(userPayingId, paidAddedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removePaidUsersFromSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removePaidUsersFromSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, removedUserIds } = data
            return await removePaidUsersFromSubscription(userPayingId, removedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedUsersToSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedUsersToSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, newAddedUserIds, newSelectedUserIds, urlOrigin } = data
            return await addedUsersToSubscription(userPayingId, newAddedUserIds, urlOrigin, newSelectedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedUsersWhenActivateSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedUsersWhenActivateSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, newAddedUserIds, newSelectedUserIds, urlOrigin } = data
            return await addedUsersWhenActivateSubscription(
                userPayingId,
                newAddedUserIds,
                urlOrigin,
                newSelectedUserIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.cancelSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { cancelSubscription } = require('./Payment/CancelSubscriptions')
            const { userPayingId } = data
            await cancelSubscription(userPayingId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.webhookSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processPaymentStatus(id, res)
    }
)

// STRIPE PREMIUM FUNCTIONS

exports.checkUserPremiumStatus = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { checkUserPremiumStatus } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await checkUserPremiumStatus(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createStripePortalSession = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { createStripePortalSession } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await createStripePortalSession(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.linkStripeAccount = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { linkStripeAccount } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await linkStripeAccount(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.handleStripeWebhook = onRequest(
    {
        timeoutSeconds: 30,
        memory: '1GB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleStripeWebhook } = require('./Premium/stripePremiumChecker')
        return await handleStripeWebhook(req, res)
    }
)

exports.dailyPremiumStatusCheck = onSchedule(
    {
        schedule: '0 2 * * *',
        timeZone: 'UTC',
        memory: '2GB',
        region: 'europe-west1',
    },
    async context => {
        const { dailyPremiumStatusCheck } = require('./Premium/stripePremiumChecker')
        return await dailyPremiumStatusCheck(context)
    }
)

exports.webhook = onRequest(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processPaymentStatus(id, res, process.env.GCLOUD_PROJECT)
    }
)

exports.updateMollieSubscription = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { updateMollieSubscription } = require('./Payment/Mollie.js')
            const { subscriptionIdInMollie, customerId, dataToUpdate } = data
            await updateMollieSubscription(subscriptionIdInMollie, customerId, dataToUpdate)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.sendMonthlyInvoiceSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processMontlyPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processMontlyPaymentStatus(id, res)
    }
)

exports.sendMonthlyInvoice = onRequest(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processMontlyPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processMontlyPaymentStatus(id, res)
    }
)

// "At 00:00 on day-of-month 1."
exports.resetUserFreePlanSecondGen = onSchedule(
    {
        schedule: '0 0 1 * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '2GB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { resetWarningsAndQuotas } = require('./Payment/QuotaWarnings')
        await resetWarningsAndQuotas(admin)
        log('Server Time', { hour: new Date().getHours(), minute: new Date().getMinutes() })
    }
)

// "Every Day at 00:00."
exports.autoCancelSubscriptionsSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GB',
    },
    async event => {
        const { autoCancelSubscription } = require('./Payment/CancelSubscriptions')
        await autoCancelSubscription()
    }
)

//ALGOLIA

exports.indexProjectsRecordsInAlgoliaSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { indexProjectsRecordsInAlgolia } = require('./AlgoliaGlobalSearchHelper')
            const { userId } = data
            await indexProjectsRecordsInAlgolia(userId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.proccessAlgoliaRecordsWhenUnlockGoalSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { proccessAlgoliaRecordsWhenUnlockGoal } = require('./AlgoliaGlobalSearchHelper')
            const { projectId, goalId } = data
            await proccessAlgoliaRecordsWhenUnlockGoal(projectId, goalId, admin)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.checkAndRemoveInactiveObjectsFromAlgoliaSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '4GB',
    },
    async event => {
        const { checkAndRemoveInactiveObjectsFromAlgolia } = require('./AlgoliaGlobalSearchHelper')
        await checkAndRemoveInactiveObjectsFromAlgolia()
        return null
    }
)

// "Every Day at 00:00."
exports.checkAndRemoveProjectsWithoutActivityFromAlgoliaSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GB',
    },
    async event => {
        const { checkAndRemoveProjectsWithoutActivityFromAlgolia } = require('./AlgoliaGlobalSearchHelper')
        await checkAndRemoveProjectsWithoutActivityFromAlgolia()
    }
)

exports.onStartIndexingAlgoliaTasksSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/tasks`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startTasksIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startTasksIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaGoalsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/goals`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startGoalsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startGoalsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaNotesSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/notes`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startNotesIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startNotesIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaContactsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/contacts`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startContactsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startContactsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaAssistantsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/assistants`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startAssistantsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startAssistantsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaChatsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/chats`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startChatsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startChatsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaUsersSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/users`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { startUsersIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startUsersIndextion(projectId, activeFullSearchDate)
    }
)

exports.onEndIndexingAlgoliaFullSearchSecondGen = onDocumentUpdated(
    {
        document: `algoliaFullSearchIndexation/{projectId}`,
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
    },
    async event => {
        const { checkAlgoliaFullSearchIndeaxtion } = require('./searchHelper')
        const { projectId } = event.params
        const fullSearchIndeaxtion = event.data.after.data()
        await checkAlgoliaFullSearchIndeaxtion(projectId, fullSearchIndeaxtion)
    }
)

//TEMPLATE AND COMMUNITY PROJECTS

exports.sendUserJoinsToGuideEmailSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const SendInBlueManager = require('./SendInBlueManager')
            const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

            const { usersToReceiveEmailIds, guideId, newUserId } = data
            const inProduction = inProductionEnvironment()

            return inProduction
                ? await SendInBlueManager.sendNewUserJoinToGuideEmail(admin, guideId, newUserId, usersToReceiveEmailIds)
                : null
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.copyTemplateObjectsSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { copyDataFromTemplateToGuide } = require('./Templates/TemplatesHelper')

            const {
                templateId,
                creatorId,
                guideId,
                userId,
                userName,
                userPhotoUrl,
                dateMiddleOfDay,
                dateNow,
                unlockedTemplate,
                isNewGuide,
                globalAssistantIds,
            } = data
            await copyDataFromTemplateToGuide(
                admin,
                admin,
                templateId,
                creatorId,
                guideId,
                userId,
                userName,
                userPhotoUrl,
                dateMiddleOfDay,
                dateNow,
                unlockedTemplate,
                isNewGuide,
                globalAssistantIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.updateTemplatesObjectsDatesSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { updateTemplatesObjectsDates } = require('./Templates/TemplatesObjectDates')
        await updateTemplatesObjectsDates(admin)
    }
)

//NOTES HISTORY

// "Every Day at 00:00."
exports.checkIfEditedNotesNeedBeCopiedSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '4GB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { processEditedNotesForRevisionHistory } = require('./NotesRevisionHistory')
        await processEditedNotesForRevisionHistory(admin)
    }
)

// "Every Day at 00:00."
exports.checkIfDeletedNotesNeedBeCleanedSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '4GB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { processRevisionHistoryForDeletedNotes } = require('./NotesRevisionHistory')
        await processRevisionHistoryForDeletedNotes(admin)
    }
)

//GOLD

exports.earnGoldSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { earnGold } = require('./Gold/goldHelper')
            const { projectId, userId, gold, slimDate, timestamp, dayDate } = data
            await earnGold(projectId, userId, gold, slimDate, timestamp, dayDate, admin)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.resetDailyGoldLimitSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GB',
    },
    async event => {
        const { resetDailyGoldLimit } = require('./Gold/goldHelper')
        resetDailyGoldLimit()
    }
)

// "At 00:00 on day-of-month 1."
exports.giveMonthlyGoldToAllUsersSecondGen = onSchedule(
    {
        schedule: '0 0 1 * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '4GB',
    },
    async context => {
        const { addMonthlyGoldToAllUsers } = require('./Gold/goldHelper')
        await addMonthlyGoldToAllUsers()
    }
)

//AI ASSISTANTS

exports.askToBotSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        console.log('askToBotSecondGen function called')
        const { data, auth } = request
        if (auth) {
            const { askToOpenAIBot } = require('./Assistant/assistantNormalTalk')
            const {
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                isPublicFor,
                language,
                assistantId,
                followerIds,
            } = data
            console.log('askToBotSecondGen: calling askToOpenAIBot with params:', {
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                isPublicFor,
                language,
                assistantId,
                followerIds,
            })
            return await askToOpenAIBot(
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                isPublicFor,
                language,
                assistantId,
                followerIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotWelcomeMessageSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotWelcomeMessageForGuide } = require('./Assistant/assistantWelcomeMessageForGuide')
            const { projectId, objectId, userIdsToNotify, guideName, language, assistantId } = data
            return await generateBotWelcomeMessageForGuide(
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotWelcomeMessageToUserSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotWelcomeMessageForGuideUser } = require('./Assistant/assistantWelcomeMessageForGuideUser')
            const {
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                userId,
                userName,
                taskListUrlOrigin,
                assistantId,
            } = data
            return await generateBotWelcomeMessageForGuideUser(
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                userId,
                userName,
                taskListUrlOrigin,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generatePreConfigTaskResultSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generatePreConfigTaskResult } = require('./Assistant/assistantPreConfigTaskTopic')
            const {
                userId,
                projectId,
                taskId,
                userIdsToNotify,
                isPublicFor,
                assistantId,
                prompt,
                language,
                aiSettings,
            } = data
            return await generatePreConfigTaskResult(
                userId,
                projectId,
                taskId,
                userIdsToNotify,
                isPublicFor,
                assistantId,
                prompt,
                language,
                aiSettings
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotAdvaiceSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotAdvaiceForTopic } = require('./Assistant/assistantAdvaiceForTopic')
            const {
                projectId,
                objectId,
                objectType,
                userIdsToNotify,
                topicName,
                language,
                isPublicFor,
                assistantId,
                followerIds,
            } = data
            return await generateBotAdvaiceForTopic(
                projectId,
                objectId,
                objectType,
                userIdsToNotify,
                topicName,
                language,
                isPublicFor,
                assistantId,
                followerIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotDailyTopicCommentSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { generateBotDailyTopicFirstComment } = require('./Assistant/assistantDailyTopic')

            const {
                userId,
                startDate,
                endDate,
                todayDate,
                lastSessionDate,
                objectId,
                userIdsToNotify,
                language,
                assistantId,
            } = data

            return await generateBotDailyTopicFirstComment(
                admin,
                userId,
                startDate,
                endDate,
                todayDate,
                lastSessionDate,
                objectId,
                userIdsToNotify,
                language,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

//VIDEOS

exports.convertVideosSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '4GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { convertVideos } = require('./videosHelper')
            return await convertVideos(admin, data)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// Delete video recordings after two weeks. run Sundays at 00:05
exports.removeOldVideosSecondGen = onSchedule(
    {
        schedule: '5 0 * * 0',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const { removeOldRecordings } = require('./videosHelper')
        await removeOldRecordings(admin)
    }
)

//PROJECTS

exports.onCreateProjectSecondGen = onDocumentCreated(
    {
        document: `/projects/{projectId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateProject } = require('./Projects/onCreateProjectFunctions')
        const project = event.data.data()
        await onCreateProject(project)
    }
)

exports.onUpdateProjectSecondGen = onDocumentUpdated(
    {
        document: 'projects/{projectId}',
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateProject } = require('./Projects/onUpdateProjectFunctions')
        const { mapProjectData } = require('./Utils/MapDataFuncions')

        const projectId = event.params.projectId
        const oldProject = mapProjectData(projectId, event.data.before.data())
        const newProject = mapProjectData(projectId, event.data.after.data())
        await onUpdateProject(projectId, oldProject, newProject)
    }
)

exports.onDeleteProjectSecondGen = onDocumentDeleted(
    {
        document: 'projects/{projectId}',
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteProject } = require('./Projects/onDeleteProjectFunctions')
        const { projectId } = event.params
        await onDeleteProject(projectId)
    }
)

//USERS

exports.onCreateUserSecondGen = onDocumentCreated(
    {
        document: `/users/{userId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateUser } = require('./Users/onCreateUserFunctions')
        const { userId } = event.params
        const user = { ...event.data.data(), uid: userId }
        await onCreateUser(user)
    }
)

exports.onUpdateUserSecondGen = onDocumentUpdated(
    {
        document: 'users/{userId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateUser } = require('./Users/onUpdateUserFunctions')
        const { userId } = event.params
        await onUpdateUser(userId, event.data)
    }
)

exports.onDeleteUserSecondGen = onDocumentDeleted(
    {
        document: 'users/{userId}',
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteUser } = require('./Users/onDeleteUserFunctions')
        const { userId } = event.params
        const user = { ...event.data.data(), uid: userId }
        await onDeleteUser(user)
    }
)

//CHATS

exports.onCreateChatSecondGen = onDocumentCreated(
    {
        document: `chatObjects/{projectId}/chats/{chatId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateChat } = require('./Chats/onCreateChatFunctions')
        const { projectId, chatId } = event.params
        const chat = { ...event.data.data(), id: chatId }
        await onCreateChat(projectId, chat)
    }
)

exports.onUpdateChatSecondGen = onDocumentUpdated(
    {
        document: 'chatObjects/{projectId}/chats/{chatId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateChat } = require('./Chats/onUpdateChatFunctions')
        const { projectId, chatId } = event.params
        await onUpdateChat(projectId, chatId, event.data)
    }
)

exports.onDeleteChatSecondGen = onDocumentDeleted(
    {
        document: 'chatObjects/{projectId}/chats/{chatId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteChat } = require('./Chats/onDeleteChatFunctions')
        const { projectId, chatId } = event.params
        const chat = { ...event.data.data(), id: chatId }
        await onDeleteChat(projectId, chat)
    }
)

//TASKS

exports.onCreateTaskSecondGen = onDocumentCreated(
    {
        document: `items/{projectId}/tasks/{taskId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateTask } = require('./Tasks/onCreateTaskFunctions')
        const { projectId, taskId } = event.params
        const task = { ...event.data.data(), id: taskId }
        await onCreateTask(task, projectId)
    }
)

exports.onUpdateTaskSecondGen = onDocumentUpdated(
    {
        document: 'items/{projectId}/tasks/{taskId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateTask } = require('./Tasks/onUpdateTaskFunctions')
        const { projectId, taskId } = event.params
        await onUpdateTask(taskId, projectId, event.data)
    }
)

exports.onDeleteTaskSecondGen = onDocumentDeleted(
    {
        document: 'items/{projectId}/tasks/{taskId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteTask } = require('./Tasks/onDeleteTaskFunctions')
        const { projectId, taskId } = event.params
        const task = { ...event.data.data(), id: taskId }
        await onDeleteTask(projectId, task)
    }
)

//ASSISTANTS

exports.onCreateAssistantSecondGen = onDocumentCreated(
    {
        document: `assistants/{projectId}/items/{assistantId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateAssistant } = require('./Assistants/onCreateAssistantFunctions')
        const { projectId, assistantId } = event.params
        const assistant = { ...event.data.data(), uid: assistantId }
        await onCreateAssistant(projectId, assistant)
    }
)

exports.onUpdateAssistantSecondGen = onDocumentUpdated(
    {
        document: 'assistants/{projectId}/items/{assistantId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateAssistant } = require('./Assistants/onUpdateAssistantFunctions.js')
        const { projectId, assistantId } = event.params
        await onUpdateAssistant(projectId, assistantId, event.data)
    }
)

exports.onDeleteAssistantSecondGen = onDocumentDeleted(
    {
        document: 'assistants/{projectId}/items/{assistantId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteAssistant } = require('./Assistants/onDeleteAssistantFunctions.js')
        const { projectId, assistantId } = event.params
        const assistant = { ...event.data.data(), uid: assistantId }
        await onDeleteAssistant(projectId, assistant)
    }
)

// ASSISTANT TASKS

exports.onCreateAssistantTaskSecondGen = onDocumentCreated(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateAssistantTask } = require('./AssistantTasks/onCreateAssistantTaskFunctions')
        const { projectId, assistantId, assistantTaskId } = event.params
        const assistantTask = { ...event.data.data(), id: assistantTaskId }
        await onCreateAssistantTask(projectId, assistantId, assistantTask)
    }
)

exports.onUpdateAssistantTaskSecondGen = onDocumentUpdated(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateAssistantTask } = require('./AssistantTasks/onUpdateAssistantTaskFunctions.js')
        const { projectId, assistantId, assistantTaskId } = event.params
        await onUpdateAssistantTask(projectId, assistantId, assistantTaskId, event.data)
    }
)

exports.onDeleteAssistantTaskSecondGen = onDocumentDeleted(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteAssistantTask } = require('./AssistantTasks/onDeleteAssistantTaskFunctions.js')
        const { projectId, assistantId, assistantTaskId } = event.params
        await onDeleteAssistantTask(projectId, assistantId, assistantTaskId)
    }
)

//CONTACTS

exports.onCreateContactSecondGen = onDocumentCreated(
    {
        document: `projectsContacts/{projectId}/contacts/{contactId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateContact } = require('./Contacts/onCreateContactFunctions')
        const { projectId, contactId } = event.params
        const contact = { ...event.data.data(), uid: contactId }
        await onCreateContact(projectId, contact)
    }
)

exports.onUpdateContactSecondGen = onDocumentUpdated(
    {
        document: 'projectsContacts/{projectId}/contacts/{contactId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateContact } = require('./Contacts/onUpdateContactFunctions')
        const { projectId, contactId } = event.params
        await onUpdateContact(projectId, contactId, event.data)
    }
)

exports.onDeleteContactSecondGen = onDocumentDeleted(
    {
        document: 'projectsContacts/{projectId}/contacts/{contactId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteContact } = require('./Contacts/onDeleteContactFunctions')
        const { projectId, contactId } = event.params
        const contact = { ...event.data.data(), uid: contactId }
        await onDeleteContact(projectId, contact)
    }
)

//GOALS

exports.onCreateGoalSecondGen = onDocumentCreated(
    {
        document: `goals/{projectId}/items/{goalId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateGoal } = require('./Goals/onCreateGoalFunctions')
        const { projectId, goalId } = event.params
        const goal = { ...event.data.data(), id: goalId }
        await onCreateGoal(projectId, goal)
    }
)

exports.onUpdateGoalSecondGen = onDocumentUpdated(
    {
        document: 'goals/{projectId}/items/{goalId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateGoal } = require('./Goals/onUpdateGoalFunctions')
        const { projectId, goalId } = event.params
        await onUpdateGoal(projectId, goalId, event.data)
    }
)

exports.onDeleteGoalSecondGen = onDocumentDeleted(
    {
        document: 'goals/{projectId}/items/{goalId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteGoal } = require('./Goals/onDeleteGoalFunctions')
        const { projectId, goalId } = event.params
        const goal = { ...event.data.data(), id: goalId }
        await onDeleteGoal(projectId, goal)
    }
)

//SKILLS

exports.onDeleteSkillSecondGen = onDocumentDeleted(
    {
        document: 'skills/{projectId}/items/{skillId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteSkill } = require('./Skills/onDeleteSkillFunctions')
        const { projectId, skillId } = event.params
        const skill = { ...event.data.data(), id: skillId }
        await onDeleteSkill(projectId, skill)
    }
)

//NOTES

exports.onCreateNoteSecondGen = onDocumentCreated(
    {
        document: `noteItems/{projectId}/notes/{noteId}`,
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateNote } = require('./Notes/onCreateNoteFunctions')
        const { projectId, noteId } = event.params
        const note = { ...event.data.data(), id: noteId }
        await onCreateNote(projectId, note)
    }
)

exports.onUpdateNoteSecondGen = onDocumentUpdated(
    {
        document: 'noteItems/{projectId}/notes/{noteId}',
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateNote } = require('./Notes/onUpdateNoteFunctions')
        const { projectId, noteId } = event.params
        await onUpdateNote(projectId, noteId, event.data)
    }
)

exports.onDeleteNoteSecondGen = onDocumentDeleted(
    {
        document: 'noteItems/{projectId}/notes/{noteId}',
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteNote } = require('./Notes/onDeleteNoteFunctions')
        const { projectId, noteId } = event.params
        const note = { ...event.data.data(), id: noteId }
        await onDeleteNote(projectId, note)
    }
)

//OTHERS yes

exports.deleteUserSecondGen = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            try {
                const { userId } = data
                await admin.auth().deleteUser(userId)
                console.log('Successfully deleted user')
            } catch (e) {
                console.log('Error deleting user:', e.message)
            }
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.sendPushNotificationSecondGen = onCall(
    {
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { processPushNotifications } = require('./PushNotifications/pushNotifications')
            return await processPushNotifications([data])
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.onRemoveWorkstreamSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { onRemoveWorkstream } = require('./Workstreams/WorkstreamHelper')
            const { projectId, streamId } = data
            return await onRemoveWorkstream(admin, projectId, streamId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addCalendarEventsToTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        minInstances: 0, //inProduction ? 5 : 1,
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addCalendarEvents } = require('./GoogleCalendarTasks/calendarTasks')
            const { events, projectId, uid, email } = data
            await addCalendarEvents(events, projectId, uid, email)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removeOldCalendarTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removeCalendarTasks } = require('./GoogleCalendarTasks/calendarTasks')
            const { uid, dateFormated, events, removeFromAllDates } = data
            await removeCalendarTasks(uid, dateFormated, events, removeFromAllDates).catch(console.error)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.onCopyProjectSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { onCopyProject } = require('./CopyProject/CopyProjectHelper')
            const { projectId, user, options } = data
            return await onCopyProject(admin, projectId, user, options)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createApiEmailTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addUnreadMailsTask } = require('./apis/EmailIntegration')
            const { projectId, date, uid, unreadMails, email } = data
            await addUnreadMailsTask(projectId, uid, date, unreadMails, email)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.increaseVersionSecondGen = onRequest(
    {
        region: 'europe-west1',
    },
    async (req, res) => {
        const admin = require('firebase-admin')
        const ref = admin.firestore().doc('info/version')
        const version = (await ref.get()).data() ?? {
            major: 0,
            minor: 1,
            patch: 0,
        }
        version.minor++
        ref.set(version)
        res.status(200).send(`Version increased to ${version.major}.${version.minor}.${version.patch}`)
    }
)

exports.sendEmailFeedNotificationSecondGen = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const SendInBlueManager = require('./SendInBlueManager')
        const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

        const inProduction = inProductionEnvironment()
        return inProduction ? await SendInBlueManager.sendFeedNotifications(admin) : null
    }
)

exports.sendEmailChatNotificationSecondGen = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const SendInBlueManager = require('./SendInBlueManager')
        const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

        const inProduction = inProductionEnvironment()
        return inProduction ? await SendInBlueManager.sendChatNotifications(admin) : null
    }
)

exports.sendChatPushNotificationsSecondGen = onSchedule(
    {
        schedule: 'every 1 minutes',
        region: 'europe-west1',
    },
    async context => {
        const { processChatPushNotifications } = require('./PushNotifications/pushNotifications')
        return await processChatPushNotifications()
    }
)

// "Every Year at 1 of january."
exports.resetInvoiceNumbersSecondGen = onSchedule(
    {
        schedule: '0 0 1 1 *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GB',
    },
    async event => {
        const { resetInvoiceNumbers } = require('./Utils/invoiceNumbers.js')
        await resetInvoiceNumbers()
    }
)

exports.scheduledFirestoreBackupSecondGen = onSchedule(
    {
        schedule: 'every 24 hours',
        region: 'europe-west1',
    },
    event => {
        const { scheduledFirestoreBackup } = require('./Utils/firestoreBackup.js')
        const firebaseProjectId = process.env.GCLOUD_PROJECT
        return scheduledFirestoreBackup(firebaseProjectId)
    }
)

exports.checkForDemoteStickyNotesSecondGen = onSchedule(
    {
        schedule: 'every 30 minutes',
        timeoutSeconds: 540,
        memory: '2GB',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const { checkStickyNotes } = require('./StickyNotesHelper')
        await checkStickyNotes(admin)
    }
)

exports.onCreateProjectInvitationSecondGen = onDocumentCreated(
    {
        document: `/projectsInvitation/{projectId}/invitations/{invitationId}`,
        region: 'europe-west1',
    },
    async event => {
        const { onCreateProjectInvitation } = require('./Utils/projectInvitation.js')
        const invitation = event.data.data()
        await onCreateProjectInvitation(invitation, event.params.projectId)
    }
)

//FOR CHECK IF STILL ARE USED

exports.sanityCheckSecondGen = onRequest(
    {
        region: 'europe-west1',
    },
    async (req, res) => {
        const { sanityCheck } = require('./Utils/sanityCheckHelper.js')
        await sanityCheck(res)
    }
)

exports.getLinkPreviewDataSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '1GB',
        minInstances: 0, //inProduction ? 5 : 1,
        region: 'europe-west1',
    },
    async (req, res) => {
        const admin = require('firebase-admin')
        const { processUrl } = require('./URLPreview/URLPreview')
        const { pathname } = req.body.data
        const previewData = await processUrl(admin, pathname)
        res.status(200).send(previewData)
    }
)

// RECURRING ASSISTANT TASKS
exports.checkRecurringAssistantTasks = onSchedule(
    {
        schedule: '*/5 * * * *', // Run every 5 minutes
        timeoutSeconds: 540,
        memory: '1GB',
        region: 'europe-west1',
    },
    async event => {
        const { checkAndExecuteRecurringTasks } = require('./Assistant/assistantRecurringTasks')
        await checkAndExecuteRecurringTasks()
    }
)
