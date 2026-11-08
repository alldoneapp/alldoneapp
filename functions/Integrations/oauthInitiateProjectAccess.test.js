'use strict'

// Security audit 2026-11: a provider connection's project becomes the destination of Admin SDK
// writes (calendar sync, email-line tasks), so every OAuth initiate callable must check that the
// caller belongs to the project (or owns the connection) before binding anything to it.

const fs = require('fs')
const path = require('path')

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

const callableBody = name => {
    const start = indexSource.indexOf(`exports.${name} = `)
    expect(start).toBeGreaterThan(-1)
    const next = indexSource.indexOf('\nexports.', start + 1)
    return indexSource.slice(start, next === -1 ? undefined : next)
}

describe.each(['googleOAuthInitiate', 'microsoftOAuthInitiate'])('%s', name => {
    it('checks project or connection access before initiating OAuth', () => {
        const body = callableBody(name)
        const initiate = body.indexOf('await initiateOAuth(')
        expect(initiate).toBeGreaterThan(-1)
        expect(body.indexOf('await assertProjectAccess(')).toBeGreaterThan(-1)
        expect(body.indexOf('await assertProjectAccess(')).toBeLessThan(initiate)
        expect(body.indexOf('await assertConnectionAccess(')).toBeGreaterThan(-1)
        expect(body.indexOf('await assertConnectionAccess(')).toBeLessThan(initiate)
    })
})

describe('retryWorkflowAiStep', () => {
    it('makes the signed-in caller pay for the retry', () => {
        expect(indexSource).toContain('retryFailedWorkflowAiRun(projectId, taskId, auth.uid)')
    })
})
