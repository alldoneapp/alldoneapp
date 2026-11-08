'use strict'

// Security audit 2026-11 (mollie-subscription-callables-unbound-userPayingId): the Mollie
// subscription callables took the payer from the request, so any signed-in account could re-price,
// extend or cancel another customer's subscription. These pin that the payer is the caller.

const fs = require('fs')
const path = require('path')
const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const {
    requireOwnPayer,
    resolvePaidSeatsToAdd,
    resolveSeatsToRemove,
    resolveNewSeats,
    resolveSeatRemoval,
    resolveCompanySubscription,
} = require('./subscriptionAccess')

const seed = () =>
    createFirestoreDouble({
        'subscriptions/payer': {
            customerId: 'cst_payer',
            subscriptionIdInMollie: 'sub_payer',
            paidUsersIds: ['payer', 'seat', 'former'],
            activePaidUsersIds: ['payer', 'seat'],
        },
        'users/payer': { customerId: 'cst_payer' },
        'users/newcomer': { customerId: '' },
    })
const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('the payer is always the caller', () => {
    test('accepts the caller’s own id or none, and refuses anybody else’s', () => {
        expect(requireOwnPayer(request('payer', { userPayingId: 'payer' }))).toBe('payer')
        expect(requireOwnPayer(request('payer', {}))).toBe('payer')
        expect(() => requireOwnPayer(request('attacker', { userPayingId: 'payer' }))).toThrow(
            expect.objectContaining({ code: 'permission-denied' })
        )
        expect(() => requireOwnPayer(request(null, { userPayingId: 'payer' }))).toThrow(
            expect.objectContaining({ code: 'unauthenticated' })
        )
    })

    test.each([
        [
            'adding paid seats',
            () =>
                resolvePaidSeatsToAdd(
                    seed(),
                    request('attacker', { userPayingId: 'payer', paidAddedUserIds: ['attacker'] })
                ),
        ],
        [
            'removing seats',
            () =>
                resolveSeatsToRemove(seed(), request('attacker', { userPayingId: 'payer', removedUserIds: ['seat'] })),
        ],
        [
            'adding new seats',
            async () =>
                resolveNewSeats(
                    request('attacker', {
                        userPayingId: 'payer',
                        newAddedUserIds: ['attacker'],
                        newSelectedUserIds: ['attacker'],
                    })
                ),
        ],
        [
            'creating a subscription for somebody else',
            () =>
                resolveCompanySubscription(
                    seed(),
                    request('attacker', { userId: 'payer', selectedUserIds: ['attacker'] })
                ),
        ],
    ])('refuses %s on another payer’s subscription', async (_, run) => {
        await expect(run()).rejects.toMatchObject({ code: 'permission-denied' })
    })
})

describe('seat lists are checked against the stored subscription', () => {
    test('re-adds only users the payer already paid for', async () => {
        await expect(
            resolvePaidSeatsToAdd(seed(), request('payer', { userPayingId: 'payer', paidAddedUserIds: ['former'] }))
        ).resolves.toEqual({ userPayingId: 'payer', paidAddedUserIds: ['former'] })
        await expect(
            resolvePaidSeatsToAdd(seed(), request('payer', { paidAddedUserIds: ['stranger'] }))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    test('removes only current seats', async () => {
        await expect(resolveSeatsToRemove(seed(), request('payer', { removedUserIds: ['seat'] }))).resolves.toEqual({
            userPayingId: 'payer',
            removedUserIds: ['seat'],
        })
        await expect(
            resolveSeatsToRemove(seed(), request('payer', { removedUserIds: ['former'] }))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    test('refuses ids that are not user ids', () => {
        expect(() => resolveNewSeats(request('payer', { newAddedUserIds: ['a/b'], newSelectedUserIds: [] }))).toThrow(
            expect.objectContaining({ code: 'invalid-argument' })
        )
        expect(() => resolveNewSeats(request('payer', { newAddedUserIds: 'seat', newSelectedUserIds: [] }))).toThrow(
            expect.objectContaining({ code: 'invalid-argument' })
        )
    })
})

describe('leaving a subscription somebody else pays for', () => {
    test('a seat holder may remove their own seat', async () => {
        await expect(
            resolveSeatRemoval(seed(), request('seat', { userPayingId: 'payer', userId: 'seat' }))
        ).resolves.toEqual({ userPayingId: 'payer', userId: 'seat' })
    })

    test('the payer may remove a seat', async () => {
        await expect(
            resolveSeatRemoval(seed(), request('payer', { userPayingId: 'payer', userId: 'seat' }))
        ).resolves.toEqual({ userPayingId: 'payer', userId: 'seat' })
    })

    test('nobody else may remove a seat, and nobody may remove a seat that does not exist', async () => {
        await expect(
            resolveSeatRemoval(seed(), request('attacker', { userPayingId: 'payer', userId: 'seat' }))
        ).rejects.toMatchObject({ code: 'permission-denied' })
        await expect(
            resolveSeatRemoval(seed(), request('attacker', { userPayingId: 'payer', userId: 'attacker' }))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })
})

describe('createCompanySubscription', () => {
    test('uses the payer’s stored Mollie customer, never one the request names', async () => {
        const resolved = await resolveCompanySubscription(
            seed(),
            request('payer', { userId: 'payer', customerId: 'cst_victim', selectedUserIds: ['payer'] })
        )
        expect(resolved).toMatchObject({ userId: 'payer', customerId: 'cst_payer', selectedUserIds: ['payer'] })
    })

    test('a first subscription starts without a customer, so a new one is created', async () => {
        const resolved = await resolveCompanySubscription(
            seed(),
            request('newcomer', { customerId: 'cst_victim', selectedUserIds: ['newcomer'] })
        )
        expect(resolved).toMatchObject({ userId: 'newcomer', customerId: '' })
    })
})

describe('index.js', () => {
    const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const block = name => {
        const start = indexSource.indexOf(`exports.${name} = onCall(`)
        expect(start).toBeGreaterThan(-1)
        return indexSource.slice(start, indexSource.indexOf('\nexports.', start + 1))
    }

    test.each([
        ['updateCreditCardNumberSecondGen', /requireOwnPayer\(request\)/],
        ['createCompanySubscriptionSecondGen', /resolveCompanySubscription\(admin\.firestore\(\), request\)/],
        ['removeUserFromSubscriptionSecondGen', /resolveSeatRemoval\(admin\.firestore\(\), request\)/],
        ['addedPaidUsersToSubscriptionSecondGen', /resolvePaidSeatsToAdd\(admin\.firestore\(\), request\)/],
        ['addedPaidUsersWhenActivateSubscriptionSecondGen', /resolvePaidSeatsToAdd\(admin\.firestore\(\), request\)/],
        ['removePaidUsersFromSubscriptionSecondGen', /resolveSeatsToRemove\(admin\.firestore\(\), request\)/],
        ['addedUsersToSubscriptionSecondGen', /resolveNewSeats\(request\)/],
        ['addedUsersWhenActivateSubscriptionSecondGen', /resolveNewSeats\(request\)/],
        ['cancelSubscriptionSecondGen', /requireOwnPayer\(request\)/],
    ])('%s takes the payer from subscriptionAccess', (name, pattern) => {
        const source = block(name)
        expect(source).toMatch(pattern)
        expect(source).not.toMatch(/=\s*data\s*$/m)
    })

    test('the generic updateMollieSubscription callable is gone', () => {
        expect(indexSource).not.toMatch(/exports\.updateMollieSubscription\b/)
    })
})
