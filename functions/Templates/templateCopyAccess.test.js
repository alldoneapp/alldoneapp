'use strict'

// Security audit 2026-11 (high): copyTemplateObjectsSecondGen took templateId, creatorId, guideId
// and userId from the request and copied through the Admin SDK, so any signed-in account could copy
// another project's open tasks (private ones included) and their notes into a project it chose.

const fs = require('fs')
const path = require('path')
const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { resolveTemplateCopyRequest } = require('./templateCopyAccess')

const NOW = Date.UTC(2026, 10, 8, 12)

function seed(overrides = {}) {
    return createFirestoreDouble({
        'users/joiner': { displayName: 'Jo Joiner', photoURL: 'https://img.example/jo.png' },
        'users/outsider': { displayName: 'Otto Outsider' },
        'users/creator': { displayName: 'Cleo Creator' },
        'projects/template1': {
            isTemplate: true,
            templateCreatorId: 'creator',
            userIds: ['creator'],
            isShared: 0,
            globalAssistantIds: ['global-a'],
        },
        'projects/privateTemplate': {
            isTemplate: true,
            templateCreatorId: 'creator',
            userIds: ['creator'],
            isShared: 2,
        },
        'projects/victimProject': { userIds: ['victim'], isShared: 0 },
        'projects/guide1': { parentTemplateId: 'template1', userIds: ['joiner', 'creator'] },
        'projects/outsiderOwn': { parentTemplateId: 'victimProject', userIds: ['outsider'] },
        'projects/outsiderGuide': { parentTemplateId: 'privateTemplate', userIds: ['outsider'] },
        ...overrides,
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('resolveTemplateCopyRequest', () => {
    test('rejects an unauthenticated call', async () => {
        await expect(
            resolveTemplateCopyRequest(seed(), request(null, { templateId: 'template1', guideId: 'guide1' }), NOW)
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    test('refuses to copy a project that is not a template (the reported exploit)', async () => {
        await expect(
            resolveTemplateCopyRequest(
                seed(),
                request('outsider', {
                    templateId: 'victimProject',
                    creatorId: 'victim',
                    guideId: 'outsiderOwn',
                    userId: 'outsider',
                }),
                NOW
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('refuses a private template the caller cannot read', async () => {
        await expect(
            resolveTemplateCopyRequest(
                seed(),
                request('outsider', { templateId: 'privateTemplate', guideId: 'outsiderGuide' }),
                NOW
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('refuses a guide the caller is not a member of', async () => {
        await expect(
            resolveTemplateCopyRequest(seed(), request('outsider', { templateId: 'template1', guideId: 'guide1' }), NOW)
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('refuses a destination that is not a guide of this template', async () => {
        const db = seed({ 'projects/joinerOwn': { userIds: ['joiner'] } })
        await expect(
            resolveTemplateCopyRequest(db, request('joiner', { templateId: 'template1', guideId: 'joinerOwn' }), NOW)
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('copies the template creator into the caller, ignoring ids from the request', async () => {
        const resolved = await resolveTemplateCopyRequest(
            seed(),
            request('joiner', {
                templateId: 'template1',
                guideId: 'guide1',
                creatorId: 'victim',
                userId: 'victim',
                userName: 'Not Me',
                globalAssistantIds: ['attacker-assistant'],
                dateMiddleOfDay: NOW - 3600000,
                dateNow: NOW + 1000,
                isNewGuide: true,
            }),
            NOW
        )
        expect(resolved).toMatchObject({
            templateId: 'template1',
            guideId: 'guide1',
            creatorId: 'creator',
            userId: 'joiner',
            userName: 'Jo Joiner',
            userPhotoUrl: 'https://img.example/jo.png',
            globalAssistantIds: ['global-a'],
            dateMiddleOfDay: NOW - 3600000,
            dateNow: NOW + 1000,
            isNewGuide: true,
        })
    })

    test('a template member may copy even when the template is private', async () => {
        const db = seed({ 'projects/guide2': { parentTemplateId: 'privateTemplate', userIds: ['creator'] } })
        const resolved = await resolveTemplateCopyRequest(
            db,
            request('creator', { templateId: 'privateTemplate', guideId: 'guide2' }),
            NOW
        )
        expect(resolved.creatorId).toBe('creator')
    })

    test('ignores client dates that are far from the server clock', async () => {
        const resolved = await resolveTemplateCopyRequest(
            seed(),
            request('joiner', { templateId: 'template1', guideId: 'guide1', dateMiddleOfDay: 0, dateNow: 'x' }),
            NOW
        )
        expect(resolved.dateMiddleOfDay).toBe(NOW)
        expect(resolved.dateNow).toBe(NOW)
    })
})

describe('copyTemplateObjectsSecondGen wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const handler = source.slice(
        source.indexOf('exports.copyTemplateObjectsSecondGen'),
        source.indexOf('exports.', source.indexOf('exports.copyTemplateObjectsSecondGen') + 10)
    )

    test('resolves the request through templateCopyAccess and never destructures request ids', () => {
        expect(handler).toMatch(/resolveTemplateCopyRequest\(admin\.firestore\(\), request\)/)
        expect(handler).not.toMatch(/=\s*data\b/)
        expect(handler).not.toMatch(/request\.data/)
    })

    test('runs the copy with feed state private to the invocation', () => {
        expect(handler).toMatch(/runWithFeedsState\(\(\) =>\s*copyDataFromTemplateToGuide\(/)
    })
})
