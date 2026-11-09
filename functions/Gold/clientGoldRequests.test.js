'use strict'

// Security audit 2026-11 (gold-callables-client-chosen-amount): what deductGoldSecondGen accepts
// from a client, and that index.js routes the Gold callables through it. Since AT-2978 a client can
// neither ask for a reward nor pay for a goal unlock through these callables.

const fs = require('fs')
const path = require('path')
const { resolveClientSpend, MAX_IFRAME_DEDUCTION_GOLD } = require('./clientGoldRequests')

const repoRoot = path.join(__dirname, '..', '..')
const indexSource = fs.readFileSync(path.join(repoRoot, 'functions', 'index.js'), 'utf8')

function callableBlock(name) {
    const start = indexSource.indexOf(`exports.${name} = onCall(`)
    expect(start).toBeGreaterThan(-1)
    const end = indexSource.indexOf('\nexports.', start + 1)
    return indexSource.slice(start, end)
}

describe('client spends', () => {
    test('an embedded tool charge must be a positive whole amount under the cap', () => {
        expect(resolveClientSpend({ gold: 30, source: 'iframe_deduction', channel: 'iframe' })).toMatchObject({
            ok: true,
            amount: 30,
        })
        for (const gold of [0, -500, 2.5, 'abc', MAX_IFRAME_DEDUCTION_GOLD + 1]) {
            expect(resolveClientSpend({ gold, source: 'iframe_deduction' })).toMatchObject({ ok: false })
        }
    })

    test.each([['goal_unlock'], ['vm_execution'], ['assistant_usage'], ['unknown_spend'], [''], [undefined]])(
        'refuses the source %p, so a client cannot write ledger entries under server sources',
        source => {
            expect(resolveClientSpend({ gold: 5, source })).toMatchObject({ ok: false })
        }
    )
})

describe('index.js routes the Gold callables through these checks', () => {
    test('deductGoldSecondGen only charges a resolved client spend', () => {
        const block = callableBlock('deductGoldSecondGen')
        expect(block).toMatch(/resolveClientSpend\(data\)/)
        expect(block).toMatch(/deductGold\(auth\.uid, spend\.amount, spend\.context\)/)
    })

    test('earnGoldSecondGen pays nothing: rewards come from the task and comment triggers', () => {
        const block = callableBlock('earnGoldSecondGen')
        expect(block).not.toMatch(/earnGold\(/)
        expect(block).toMatch(/success: false/)
    })

    test('refundGoldSecondGen only gives back the caller’s own charges', () => {
        const block = callableBlock('refundGoldSecondGen')
        expect(block).toMatch(/refundClientSpend\(auth\.uid/)
        expect(block).not.toMatch(/\brefundGold\(/)
    })
})
