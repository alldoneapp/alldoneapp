'use strict'

jest.mock('../AlgoliaGlobalSearchHelper', () => ({ deleteUserRecord: jest.fn() }))
jest.mock('../Assistant/assistantHeartbeatSchedule', () => ({
    deleteHeartbeatSchedulesForUser: jest.fn(),
    safelySyncHeartbeatSchedules: jest.fn(callback => callback()),
}))
jest.mock('../Payment/Mollie', () => {
    throw new Error('The user deletion trigger must not load the retired Mollie integration')
})
jest.mock('../Payment/CancelSubscriptions', () => {
    throw new Error('The user deletion trigger must not load the retired Mollie cancellation flow')
})
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { arrayRemove: value => ({ operation: 'arrayRemove', value }) },
}))

const { processPremiumStatusPaidByOtherUser } = require('./onDeleteUserFunctions')

function createAdmin({ sponsorship, payerSubscription }) {
    const update = jest.fn().mockResolvedValue()
    const removeSponsorship = jest.fn().mockResolvedValue()
    const documents = {
        'subscriptionsPaidByOtherUser/deleted-user': {
            get: jest.fn().mockResolvedValue({ data: () => sponsorship }),
            delete: removeSponsorship,
        },
        'subscriptions/payer-user': {
            get: jest.fn().mockResolvedValue({ data: () => payerSubscription }),
            update,
        },
    }
    return {
        admin: { firestore: jest.fn(() => ({ doc: path => documents[path] })) },
        removeSponsorship,
        update,
    }
}

describe('user deletion legacy sponsorship cleanup', () => {
    it('removes the deleted user from the payer record without calling Mollie', async () => {
        const { admin, removeSponsorship, update } = createAdmin({
            sponsorship: { userPayingId: 'payer-user' },
            payerSubscription: { status: 'legacy' },
        })

        await processPremiumStatusPaidByOtherUser('deleted-user', admin)

        expect(update).toHaveBeenCalledWith({
            activePaidUsersIds: { operation: 'arrayRemove', value: 'deleted-user' },
            paidUsersIds: { operation: 'arrayRemove', value: 'deleted-user' },
            selectedUserIds: { operation: 'arrayRemove', value: 'deleted-user' },
        })
        expect(removeSponsorship).toHaveBeenCalledTimes(1)
    })

    it('still removes an orphan sponsorship record when the payer record is missing', async () => {
        const { admin, removeSponsorship, update } = createAdmin({
            sponsorship: { userPayingId: 'payer-user' },
            payerSubscription: undefined,
        })

        await processPremiumStatusPaidByOtherUser('deleted-user', admin)

        expect(update).not.toHaveBeenCalled()
        expect(removeSponsorship).toHaveBeenCalledTimes(1)
    })
})
