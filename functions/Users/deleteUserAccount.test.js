'use strict'

const {
    cancelStripeSubscriptions,
    deleteUserAccount,
    getUserProjectCleanupUpdate,
    getWorkflowCleanupUpdate,
    isLastProjectUser,
} = require('./deleteUserAccount')

const FieldValue = {
    arrayRemove: value => ({ operation: 'arrayRemove', value }),
    delete: () => ({ operation: 'delete' }),
}

describe('deleteUserAccount', () => {
    it('deletes Firebase Auth only after Firestore cleanup succeeds', async () => {
        const order = []
        const cleanup = jest.fn(async () => {
            order.push('firestore')
            return { deletedProjects: 1, leftProjects: 0 }
        })
        const cancelBilling = jest.fn(async () => {
            order.push('billing')
            return { stripeSubscriptionsCanceled: 1 }
        })
        const auth = {
            deleteUser: jest.fn(async () => {
                order.push('auth')
            }),
        }

        await expect(
            deleteUserAccount({ db: {}, auth, FieldValue, userId: 'user-1', cancelBilling, cleanup })
        ).resolves.toEqual({
            success: true,
            authDeleted: true,
            stripeSubscriptionsCanceled: 1,
            deletedProjects: 1,
            leftProjects: 0,
        })

        expect(order).toEqual(['billing', 'firestore', 'auth'])
    })

    it('keeps Firebase Auth intact when Firestore cleanup fails so deletion can be retried', async () => {
        const cleanupError = new Error('Firestore unavailable')
        const cleanup = jest.fn().mockRejectedValue(cleanupError)
        const cancelBilling = jest.fn().mockResolvedValue({ stripeSubscriptionsCanceled: 0 })
        const auth = { deleteUser: jest.fn() }

        await expect(
            deleteUserAccount({ db: {}, auth, FieldValue, userId: 'user-1', cancelBilling, cleanup })
        ).rejects.toBe(cleanupError)
        expect(auth.deleteUser).not.toHaveBeenCalled()
    })

    it('keeps Firestore and Auth intact when Stripe cancellation fails', async () => {
        const billingError = new Error('Stripe unavailable')
        const cancelBilling = jest.fn().mockRejectedValue(billingError)
        const cleanup = jest.fn()
        const auth = { deleteUser: jest.fn() }

        await expect(
            deleteUserAccount({ db: {}, auth, FieldValue, userId: 'user-1', cancelBilling, cleanup })
        ).rejects.toBe(billingError)
        expect(cleanup).not.toHaveBeenCalled()
        expect(auth.deleteUser).not.toHaveBeenCalled()
    })

    it('treats an already-missing Auth identity as an idempotent completion', async () => {
        const cleanup = jest.fn().mockResolvedValue({ deletedProjects: 0, leftProjects: 0 })
        const cancelBilling = jest.fn().mockResolvedValue({ stripeSubscriptionsCanceled: 0 })
        const auth = {
            deleteUser: jest
                .fn()
                .mockRejectedValue(Object.assign(new Error('missing'), { code: 'auth/user-not-found' })),
        }

        await expect(
            deleteUserAccount({ db: {}, auth, FieldValue, userId: 'user-1', cancelBilling, cleanup })
        ).resolves.toMatchObject({ success: true, authDeleted: false })
    })
})

describe('cancelStripeSubscriptions', () => {
    const createDb = user => ({
        doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue(user ? { exists: true, data: () => user } : { exists: false }),
        })),
    })

    it('cancels every live Stripe subscription and ignores terminal subscriptions', async () => {
        const stripe = {
            subscriptions: {
                list: jest.fn().mockResolvedValue({
                    data: [
                        { id: 'sub-active', status: 'active' },
                        { id: 'sub-canceled', status: 'canceled' },
                        { id: 'sub-expired', status: 'incomplete_expired' },
                    ],
                    has_more: false,
                }),
                retrieve: jest.fn(),
                cancel: jest.fn().mockResolvedValue({ status: 'canceled' }),
            },
        }

        await expect(
            cancelStripeSubscriptions({
                db: createDb({ stripeCustomerId: 'cus-1', premium: { subscriptionId: 'sub-active' } }),
                stripe,
                userId: 'user-1',
            })
        ).resolves.toEqual({ stripeSubscriptionsCanceled: 1 })
        expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus-1', status: 'all', limit: 100 })
        expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
        expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub-active')
    })

    it('uses the stored subscription when a customer id is unavailable', async () => {
        const stripe = {
            subscriptions: {
                list: jest.fn(),
                retrieve: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'trialing' }),
                cancel: jest.fn().mockResolvedValue({ status: 'canceled' }),
            },
        }

        await expect(
            cancelStripeSubscriptions({
                db: createDb({ premium: { subscriptionId: 'sub-1' } }),
                stripe,
                userId: 'user-1',
            })
        ).resolves.toEqual({ stripeSubscriptionsCanceled: 1 })
        expect(stripe.subscriptions.list).not.toHaveBeenCalled()
        expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub-1')
    })

    it('requires Stripe configuration only for accounts linked to Stripe billing', async () => {
        await expect(
            cancelStripeSubscriptions({
                db: createDb({ stripeCustomerId: 'cus-1' }),
                stripe: null,
                userId: 'user-1',
            })
        ).rejects.toThrow('Stripe is not configured')

        await expect(
            cancelStripeSubscriptions({ db: createDb({ premium: { status: 'free' } }), stripe: null, userId: 'user-2' })
        ).resolves.toEqual({ stripeSubscriptionsCanceled: 0 })
    })
})

describe('account deletion cleanup projections', () => {
    it('removes project arrays and real map entries without writing through nullable legacy maps', () => {
        const update = getUserProjectCleanupUpdate(
            {
                apisConnected: null,
                workflow: { 'project-1': { step: {} } },
                lastAssistantCommentData: {
                    allProjects: { projectId: 'project-1' },
                    'project-1': { commentId: 'comment-1' },
                },
            },
            'project-1',
            FieldValue
        )

        expect(update.projectIds).toEqual({ operation: 'arrayRemove', value: 'project-1' })
        expect(update['workflow.project-1']).toEqual({ operation: 'delete' })
        expect(update['lastAssistantCommentData.project-1']).toEqual({ operation: 'delete' })
        expect(update['lastAssistantCommentData.allProjects']).toEqual({ operation: 'delete' })
        expect(update['apisConnected.project-1']).toBeUndefined()
    })

    it('removes reviewer steps and clears surviving added-by references', () => {
        const update = getWorkflowCleanupUpdate(
            {
                workflow: {
                    'project-1': {
                        reviewer: { reviewerUid: 'deleted-user' },
                        creator: { reviewerUid: 'other-user', addedById: 'deleted-user' },
                    },
                },
            },
            'project-1',
            'deleted-user',
            FieldValue
        )

        expect(update['workflow.project-1.reviewer']).toEqual({ operation: 'delete' })
        expect(update['workflow.project-1.creator.addedById']).toBe('')
    })

    it('preserves the legacy guide last-user semantics', () => {
        expect(isLastProjectUser({ userIds: ['user-1'] }, 'user-1')).toBe(true)
        expect(isLastProjectUser({ userIds: ['user-1', 'user-2'] }, 'user-1')).toBe(false)
        expect(
            isLastProjectUser(
                {
                    parentTemplateId: 'template-1',
                    templateCreatorId: 'template-owner',
                    userIds: ['user-1', 'template-owner', 'administrator'],
                },
                'user-1',
                'administrator'
            )
        ).toBe(true)
    })
})
