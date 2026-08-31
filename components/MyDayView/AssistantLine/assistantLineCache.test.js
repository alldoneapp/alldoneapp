/**
 * @jest-environment jsdom
 */

import {
    ASSISTANT_LINE_CACHE_MAX_AGE_MS,
    getAssistantTasksCacheKey,
    readAssistantTasksCache,
    readLastCommentCache,
    writeAssistantTasksCache,
    writeLastCommentCache,
} from './assistantLineCache'

const tasksContext = { userId: 'user-1', projectId: 'project-1', assistantId: 'assistant-1' }
const commentContext = {
    userId: 'user-1',
    projectId: 'project-1',
    objectType: 'topics',
    objectId: 'chat-1',
}

describe('assistantLineCache', () => {
    beforeEach(() => {
        localStorage.clear()
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
        jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('reuses assistant quick actions for the same user and assistant', () => {
        const tasks = [{ id: 'task-1', name: 'Daily plan', variables: [] }]

        expect(writeAssistantTasksCache(tasksContext, tasks)).toBe(true)
        expect(readAssistantTasksCache(tasksContext)).toEqual(tasks)
        expect(readAssistantTasksCache({ ...tasksContext, userId: 'user-2' })).toBeNull()
    })

    it('stores only the last-comment preview fields', () => {
        expect(
            writeLastCommentCache(commentContext, {
                commentText: 'Welcome back',
                chat: { title: 'Daily planning', assistantId: 'assistant-1', privateField: 'not cached' },
            })
        ).toBe(true)

        expect(readLastCommentCache(commentContext)).toEqual({
            commentText: 'Welcome back',
            chat: { title: 'Daily planning', assistantId: 'assistant-1' },
        })
    })

    it('expires online data after one day but keeps it available offline', () => {
        writeAssistantTasksCache(tasksContext, [{ id: 'task-1' }])
        Date.now.mockReturnValue(1_000_000 + ASSISTANT_LINE_CACHE_MAX_AGE_MS + 1)

        expect(readAssistantTasksCache(tasksContext)).toBeNull()

        writeAssistantTasksCache(tasksContext, [{ id: 'task-2' }])
        Date.now.mockReturnValue(1_000_000 + ASSISTANT_LINE_CACHE_MAX_AGE_MS * 2 + 2)
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

        expect(readAssistantTasksCache(tasksContext)).toEqual([{ id: 'task-2' }])
    })

    it('discards malformed cache entries', () => {
        localStorage.setItem(getAssistantTasksCacheKey(tasksContext), '{broken-json')

        expect(readAssistantTasksCache(tasksContext)).toBeNull()
        expect(localStorage.getItem(getAssistantTasksCacheKey(tasksContext))).toBeNull()
    })
})
