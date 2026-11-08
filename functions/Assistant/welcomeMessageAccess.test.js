'use strict'

// Security audit 2026-11 (critical): the guide welcome-message callables ran a project assistant,
// with its tools, as whichever user the request named. These pin that the run is bound to the
// signed-in member and runs with no tools and no user context.

jest.mock('./assistantHelper', () => ({
    storeBotAnswerStream: jest.fn(async () => {}),
    interactWithChatStream: jest.fn(async () => 'stream'),
    getAssistantForChat: jest.fn(async () => ({
        uid: 'assistant-1',
        model: 'MODEL',
        temperature: 'TEMP',
        instructions: 'be nice',
        displayName: 'Anna',
        allowedTools: ['update_user_memory', 'get_user_projects', 'execute_task_in_vm'],
    })),
    addBaseInstructions: jest.fn(async () => {}),
    parseTextForUseLiKePrompt: text => text,
    getCommonData: jest.fn(async () => ({})),
    replaceUserNameByMention: (name, id, text) => text,
    addSpaceToUrl: (url, text) => text,
}))
jest.mock('../Users/usersFirestore', () => ({ getUserData: jest.fn(async () => ({ timezone: 1 })) }))

const helper = require('./assistantHelper')
const { createFirestoreDouble } = require('./__securityFirestoreDouble')
const { resolveWelcomeMessageRequest, DEFAULT_APP_ORIGIN } = require('./welcomeMessageAccess')
const { generateBotWelcomeMessageForGuide } = require('./assistantWelcomeMessageForGuide')
const { generateBotWelcomeMessageForGuideUser } = require('./assistantWelcomeMessageForGuideUser')

function seed() {
    return createFirestoreDouble({
        'users/member': { displayName: 'Mia Member' },
        'users/victim': { displayName: 'Victor Victim' },
        'users/outsider': { displayName: 'Otto Outsider' },
        'projects/guide1': { userIds: ['member', 'victim'] },
        'chatObjects/guide1/chats/welcome': { isPublicFor: [0] },
        'chatObjects/guide1/chats/private': { isPublicFor: ['victim'] },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('resolveWelcomeMessageRequest', () => {
    test('rejects an unauthenticated call', async () => {
        await expect(
            resolveWelcomeMessageRequest(seed(), request(null, { projectId: 'guide1', objectId: 'welcome' }))
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    test('rejects a caller who is not a member of the project', async () => {
        await expect(
            resolveWelcomeMessageRequest(seed(), request('outsider', { projectId: 'guide1', objectId: 'welcome' }))
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('rejects a member who cannot read the chat', async () => {
        await expect(
            resolveWelcomeMessageRequest(seed(), request('member', { projectId: 'guide1', objectId: 'private' }))
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('greets the caller, never the user named in the request', async () => {
        const resolved = await resolveWelcomeMessageRequest(
            seed(),
            request('member', {
                projectId: 'guide1',
                objectId: 'welcome',
                userId: 'victim',
                userName: 'Victor',
                userIdsToNotify: ['victim', 'outsider', 'member', 42],
                taskListUrlOrigin: 'https://evil.example.com',
            }),
            { greetCaller: true }
        )
        expect(resolved.callerUid).toBe('member')
        expect(resolved.userName).toBe('Mia')
        expect(resolved.userIdsToNotify).toEqual(['victim', 'member'])
        expect(resolved.taskListUrlOrigin).toBe(DEFAULT_APP_ORIGIN)
    })

    test('keeps an Alldone app origin for the task link', async () => {
        const resolved = await resolveWelcomeMessageRequest(
            seed(),
            request('member', {
                projectId: 'guide1',
                objectId: 'welcome',
                taskListUrlOrigin: 'https://my.alldone.app',
            }),
            { greetCaller: true }
        )
        expect(resolved.taskListUrlOrigin).toBe('https://my.alldone.app')
    })
})

describe('welcome message runs', () => {
    beforeEach(() => jest.clearAllMocks())

    test.each([
        ['group welcome', () => generateBotWelcomeMessageForGuide('guide1', 'welcome', ['victim'], 'Guide', 'en', 'a')],
        [
            'user welcome',
            () =>
                generateBotWelcomeMessageForGuideUser(
                    'guide1',
                    'welcome',
                    ['victim'],
                    'Guide',
                    'en',
                    'member',
                    'Mia',
                    'https://my.alldone.app',
                    'a'
                ),
        ],
    ])('%s runs with no tools and no user context', async (_, run) => {
        await run()
        const [, , , tools, runtime] = helper.interactWithChatStream.mock.calls[0]
        expect(tools).toEqual([])
        expect(runtime.requestUserId).toBeNull()
        const baseCall = helper.addBaseInstructions.mock.calls[0]
        expect(baseCall[4]).toEqual([])
        expect(baseCall[6].requestUserId).toBeNull()
        const storeCall = helper.storeBotAnswerStream.mock.calls[0]
        expect(storeCall[15]).toEqual([])
        expect(storeCall[18].requestUserId).toBeNull()
    })
})
