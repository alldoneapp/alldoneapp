'use strict'

// Security audit 2026-11 (gold-callables-client-chosen-amount): what deductGoldSecondGen and
// earnGoldSecondGen accept from a client, and that index.js actually routes them through it.

const fs = require('fs')
const path = require('path')
const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const {
    resolveClientSpend,
    resolveClientReward,
    GOAL_UNLOCK_GOLD,
    MAX_CLIENT_REWARD_GOLD,
    MAX_IFRAME_DEDUCTION_GOLD,
} = require('./clientGoldRequests')

const repoRoot = path.join(__dirname, '..', '..')
const indexSource = fs.readFileSync(path.join(repoRoot, 'functions', 'index.js'), 'utf8')

function callableBlock(name) {
    const start = indexSource.indexOf(`exports.${name} = onCall(`)
    expect(start).toBeGreaterThan(-1)
    const end = indexSource.indexOf('\nexports.', start + 1)
    return indexSource.slice(start, end)
}

describe('client spends', () => {
    test('a goal unlock is charged at the server price whatever the request says', () => {
        for (const gold of [1, -500, 80, 'abc', undefined]) {
            expect(resolveClientSpend({ gold, source: 'goal_unlock', goalId: 'g1' })).toEqual({
                ok: true,
                amount: GOAL_UNLOCK_GOLD,
                context: { goalId: 'g1', source: 'goal_unlock' },
            })
        }
    })

    test('the server price matches UNLOCK_GOAL_COST in the app', () => {
        const helper = fs.readFileSync(path.join(repoRoot, 'components', 'Guides', 'guidesHelper.js'), 'utf8')
        expect(helper).toMatch(new RegExp(`UNLOCK_GOAL_COST = ${GOAL_UNLOCK_GOLD}\\b`))
    })

    test('an embedded tool charge must be a positive whole amount under the cap', () => {
        expect(resolveClientSpend({ gold: 30, source: 'iframe_deduction', channel: 'iframe' })).toMatchObject({
            ok: true,
            amount: 30,
        })
        for (const gold of [0, -500, 2.5, 'abc', MAX_IFRAME_DEDUCTION_GOLD + 1]) {
            expect(resolveClientSpend({ gold, source: 'iframe_deduction' })).toMatchObject({ ok: false })
        }
    })

    test.each([['vm_execution'], ['assistant_usage'], ['unknown_spend'], [''], [undefined]])(
        'refuses the source %p, so a client cannot write ledger entries under server sources',
        source => {
            expect(resolveClientSpend({ gold: 5, source })).toMatchObject({ ok: false })
        }
    )
})

describe('client rewards', () => {
    const db = () =>
        createFirestoreDouble({
            'projects/p1': { userIds: ['caller', 'reviewer'] },
            'projects/other': { userIds: ['stranger'] },
        })
    const reward = overrides => ({
        projectId: 'p1',
        userId: 'reviewer',
        gold: 3,
        slimDate: '08112026',
        dayDate: 20261108,
        timestamp: 1,
        rewardKey: 'task-1:1:reviewer',
        objectId: 'task-1',
        objectType: 'task',
        ...overrides,
    })

    test('rewards a project member for a caller in the same project', async () => {
        expect(await resolveClientReward(db(), 'caller', reward())).toMatchObject({
            ok: true,
            projectId: 'p1',
            userId: 'reviewer',
            gold: 3,
            context: { rewardKey: 'task-1:1:reviewer', objectId: 'task-1', objectType: 'task' },
        })
    })

    test('pays at most one task reward per call', async () => {
        expect(await resolveClientReward(db(), 'caller', reward({ gold: 100000 }))).toMatchObject({
            ok: true,
            gold: MAX_CLIENT_REWARD_GOLD,
        })
    })

    test.each([
        ['a caller outside the project', 'outsider', {}],
        ['a recipient outside the project', 'caller', { userId: 'stranger' }],
        ['a project the caller does not belong to', 'caller', { projectId: 'other' }],
        ['a missing project', 'caller', { projectId: '' }],
        ['a negative amount', 'caller', { gold: -5 }],
        ['a fractional amount', 'caller', { gold: 2.5 }],
        ['a date that is a path', 'caller', { slimDate: '../x/y' }],
        ['a non-numeric day', 'caller', { dayDate: 'today' }],
    ])('refuses %s', async (_, caller, overrides) => {
        expect(await resolveClientReward(db(), caller, reward(overrides))).toMatchObject({ ok: false })
    })
})

describe('index.js routes the Gold callables through these checks', () => {
    test('deductGoldSecondGen only charges a resolved client spend', () => {
        const block = callableBlock('deductGoldSecondGen')
        expect(block).toMatch(/resolveClientSpend\(data\)/)
        expect(block).toMatch(/deductGold\(auth\.uid, spend\.amount, spend\.context\)/)
    })

    test('earnGoldSecondGen only pays a resolved reward', () => {
        const block = callableBlock('earnGoldSecondGen')
        expect(block).toMatch(/resolveClientReward\(admin\.firestore\(\), auth\.uid, data\)/)
        expect(block).toMatch(/earnGold\(\s*reward\.projectId,\s*reward\.userId,\s*reward\.gold/)
    })

    test('refundGoldSecondGen only gives back the caller’s own charges', () => {
        const block = callableBlock('refundGoldSecondGen')
        expect(block).toMatch(/refundClientSpend\(auth\.uid/)
        expect(block).not.toMatch(/\brefundGold\(/)
    })
})
