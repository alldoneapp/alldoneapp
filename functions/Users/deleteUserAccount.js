'use strict'

const PROJECT_ARRAY_FIELDS = [
    'projectIds',
    'archivedProjectIds',
    'templateProjectIds',
    'guideProjectIds',
    'copyProjectIds',
    'invitedProjectIds',
]

const PROJECT_MAP_FIELDS = [
    'workflow',
    'workstreams',
    'lastVisitBoard',
    'lastVisitBoardInGoals',
    'quotaWarnings',
    'statisticsSelectedUsersIds',
    'apisConnected',
    'noteIdsByProject',
    'unlockedKeysByGuides',
    'commentsData',
    'lastAssistantCommentData',
]

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const isNotFound = error => error?.code === 5 || error?.code === 'not-found'
const isStripeResourceMissing = error => error?.code === 'resource_missing' || error?.statusCode === 404
const isTerminalStripeSubscription = subscription =>
    subscription?.status === 'canceled' || subscription?.status === 'incomplete_expired'

function isLastProjectUser(project = {}, userId, administratorId = '') {
    const userIds = Array.isArray(project.userIds) ? project.userIds : []
    if (!project.parentTemplateId) return userIds.filter(id => id !== userId).length === 0

    return (
        userIds.filter(
            id => id !== userId && id !== project.templateCreatorId && (!administratorId || id !== administratorId)
        ).length === 0
    )
}

function getUserProjectCleanupUpdate(userData = {}, projectId, FieldValue) {
    const update = {}
    PROJECT_ARRAY_FIELDS.forEach(field => {
        update[field] = FieldValue.arrayRemove(projectId)
    })
    PROJECT_MAP_FIELDS.forEach(field => {
        if (isRecord(userData[field]) && Object.prototype.hasOwnProperty.call(userData[field], projectId)) {
            update[`${field}.${projectId}`] = FieldValue.delete()
        }
    })
    if (userData.lastAssistantCommentData?.allProjects?.projectId === projectId) {
        update['lastAssistantCommentData.allProjects'] = FieldValue.delete()
    }
    return update
}

function getWorkflowCleanupUpdate(userData = {}, projectId, deletedUserId, FieldValue) {
    const projectWorkflow = userData.workflow?.[projectId]
    if (!isRecord(projectWorkflow)) return {}

    const update = {}
    Object.entries(projectWorkflow).forEach(([stepId, step]) => {
        if (step?.reviewerUid === deletedUserId) {
            update[`workflow.${projectId}.${stepId}`] = FieldValue.delete()
        } else if (step?.addedById === deletedUserId) {
            update[`workflow.${projectId}.${stepId}.addedById`] = ''
        }
    })
    return update
}

const createMutations = () => ({ updates: new Map(), sets: new Map(), deletes: new Map() })

function addUpdate(mutations, ref, data) {
    if (!data || Object.keys(data).length === 0) return
    const current = mutations.updates.get(ref.path)
    mutations.updates.set(ref.path, { ref, data: { ...(current?.data || {}), ...data } })
}

function addSet(mutations, ref, data) {
    const current = mutations.sets.get(ref.path)
    mutations.sets.set(ref.path, { ref, data: { ...(current?.data || {}), ...data } })
}

function addDelete(mutations, ref) {
    mutations.deletes.set(ref.path, ref)
}

async function commitMutations(db, mutations) {
    const operations = [
        ...Array.from(mutations.updates.values()).map(item => ({ type: 'update', ...item })),
        ...Array.from(mutations.sets.values()).map(item => ({ type: 'set', ...item })),
        ...Array.from(mutations.deletes.values()).map(ref => ({ type: 'delete', ref })),
    ]
    if (operations.length === 0) return

    const writer = db.bulkWriter()
    writer.onWriteError(error => {
        if (isNotFound(error)) return false
        return error.failedAttempts < 5
    })
    const writes = operations.map(operation => {
        let promise
        if (operation.type === 'update') promise = writer.update(operation.ref, operation.data)
        else if (operation.type === 'set') promise = writer.set(operation.ref, operation.data, { merge: true })
        else promise = writer.delete(operation.ref)
        return promise.catch(error => {
            if (isNotFound(error)) return
            throw error
        })
    })
    await writer.close()
    await Promise.all(writes)
}

async function getAdministratorId(db) {
    const role = await db
        .doc('roles/administrator')
        .get()
        .catch(() => null)
    return role?.exists && typeof role.data()?.userId === 'string' ? role.data().userId : ''
}

async function getProjectUsers(db, projectId) {
    return db.collection('users').where('projectIds', 'array-contains', projectId).get()
}

async function getInvitedUsers(db, projectId) {
    return db.collection('users').where('invitedProjectIds', 'array-contains', projectId).get()
}

async function getStripeCustomerSubscriptions(stripe, customerId) {
    const subscriptions = []
    let startingAfter

    do {
        const page = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        })
        subscriptions.push(...page.data)
        startingAfter = page.has_more && page.data.length > 0 ? page.data[page.data.length - 1].id : undefined
    } while (startingAfter)

    return subscriptions
}

async function getStripeSubscription(stripe, subscriptionId) {
    try {
        return await stripe.subscriptions.retrieve(subscriptionId)
    } catch (error) {
        if (isStripeResourceMissing(error)) return null
        throw error
    }
}

async function cancelStripeSubscriptions({ db, stripe, userId }) {
    const userDocument = await db.doc(`users/${userId}`).get()
    if (!userDocument.exists) return { stripeSubscriptionsCanceled: 0 }

    const user = userDocument.data() || {}
    const customerId = typeof user.stripeCustomerId === 'string' ? user.stripeCustomerId : ''
    const subscriptionId = typeof user.premium?.subscriptionId === 'string' ? user.premium.subscriptionId : ''
    if (!customerId && !subscriptionId) return { stripeSubscriptionsCanceled: 0 }
    if (!stripe) throw new Error('Stripe is not configured; account deletion cannot safely cancel billing')

    const subscriptions = customerId ? await getStripeCustomerSubscriptions(stripe, customerId) : []
    if (subscriptionId && !subscriptions.some(subscription => subscription.id === subscriptionId)) {
        const subscription = await getStripeSubscription(stripe, subscriptionId)
        if (subscription) subscriptions.push(subscription)
    }

    let stripeSubscriptionsCanceled = 0
    for (const subscription of subscriptions) {
        if (!subscription?.id || isTerminalStripeSubscription(subscription)) continue
        try {
            await stripe.subscriptions.cancel(subscription.id)
            stripeSubscriptionsCanceled += 1
        } catch (error) {
            // A concurrent webhook or an earlier retry may already have removed it.
            if (!isStripeResourceMissing(error)) throw error
        }
    }
    return { stripeSubscriptionsCanceled }
}

async function removeDeletedProject({ db, FieldValue, projectDoc, userId }) {
    const projectId = projectDoc.id
    const project = projectDoc.data() || {}
    const [members, invitees] = await Promise.all([getProjectUsers(db, projectId), getInvitedUsers(db, projectId)])
    const affectedUsers = new Map()
    ;[...members.docs, ...invitees.docs].forEach(document => affectedUsers.set(document.id, document))

    // Leave the project document in place until every membership reference is clean. A failed
    // invocation can then rediscover the project through projects.userIds and repeat safely.
    const cleanup = createMutations()
    affectedUsers.forEach((document, affectedUserId) => {
        if (affectedUserId === userId) return
        addUpdate(cleanup, document.ref, getUserProjectCleanupUpdate(document.data() || {}, projectId, FieldValue))
        addSet(cleanup, db.doc(`userForceReloads/${affectedUserId}`), { reload: true, projectId })
    })
    if (project.parentTemplateId) {
        addUpdate(cleanup, db.doc(`projects/${project.parentTemplateId}`), {
            guideProjectIds: FieldValue.arrayRemove(projectId),
        })
    }
    await commitMutations(db, cleanup)

    // Its Firestore deletion trigger owns recursive project-data cleanup.
    await projectDoc.ref.delete().catch(error => {
        if (!isNotFound(error)) throw error
    })
    return { deletedProjects: 1, leftProjects: 0 }
}

async function leaveSharedProject({ db, FieldValue, projectDoc, userId }) {
    const projectId = projectDoc.id
    const [workstreams, members] = await Promise.all([
        db.collection(`projectsWorkstreams/${projectId}/workstreams`).where('userIds', 'array-contains', userId).get(),
        getProjectUsers(db, projectId),
    ])

    // Keep userId on the project until dependent cleanup succeeds, so a retry can discover it.
    const cleanup = createMutations()
    workstreams.docs.forEach(document => {
        addUpdate(cleanup, document.ref, { userIds: FieldValue.arrayRemove(userId) })
    })
    members.docs.forEach(document => {
        if (document.id === userId) return
        addUpdate(cleanup, document.ref, getWorkflowCleanupUpdate(document.data() || {}, projectId, userId, FieldValue))
        addSet(cleanup, db.doc(`userForceReloads/${document.id}`), { reload: true, projectId })
    })
    await commitMutations(db, cleanup)

    await projectDoc.ref.update({
        userIds: FieldValue.arrayRemove(userId),
        [`usersData.${userId}`]: FieldValue.delete(),
    })
    return { deletedProjects: 0, leftProjects: 1 }
}

async function cleanupUserFirestore({ db, FieldValue, userId }) {
    const [projects, administratorId] = await Promise.all([
        db.collection('projects').where('userIds', 'array-contains', userId).get(),
        getAdministratorId(db),
    ])
    const totals = { deletedProjects: 0, leftProjects: 0 }

    for (const projectDoc of projects.docs) {
        const project = projectDoc.data() || {}
        const result = isLastProjectUser(project, userId, administratorId)
            ? await removeDeletedProject({ db, FieldValue, projectDoc, userId })
            : await leaveSharedProject({ db, FieldValue, projectDoc, userId })
        totals.deletedProjects += result.deletedProjects
        totals.leftProjects += result.leftProjects
    }

    const personal = createMutations()
    addDelete(personal, db.doc(`invoiceNumbers/customInvoiceNumber/users/${userId}`))
    addDelete(personal, db.doc(`karmaPoints/${userId}`))
    addDelete(personal, db.doc(`users/${userId}`))
    await commitMutations(db, personal)
    return totals
}

async function deleteUserAccount({
    db,
    auth,
    FieldValue,
    stripe,
    userId,
    cancelBilling = cancelStripeSubscriptions,
    cleanup = cleanupUserFirestore,
}) {
    // Billing must be settled first. If Stripe or Firestore fails, keeping Firebase Auth lets the
    // owner sign in and retry instead of leaving a paid but inaccessible account behind.
    const billing = await cancelBilling({ db, stripe, userId })
    const totals = await cleanup({ db, FieldValue, userId })
    let authDeleted = true
    try {
        await auth.deleteUser(userId)
    } catch (error) {
        if (!isNotFound(error) && error?.code !== 'auth/user-not-found') throw error
        authDeleted = false
    }
    return { success: true, authDeleted, ...billing, ...totals }
}

module.exports = {
    cancelStripeSubscriptions,
    cleanupUserFirestore,
    deleteUserAccount,
    getUserProjectCleanupUpdate,
    getWorkflowCleanupUpdate,
    isLastProjectUser,
}
