'use strict'

// AT-2978 (security decision 1): Gold rewards are granted by the server from the task and comment
// triggers, never on a request from the browser.

const fs = require('fs')
const path = require('path')
const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const {
    getRewardGoldAmount,
    resolveTaskProgressReward,
    awardTaskProgressGold,
    awardCommentGold,
    buildTaskProgressRewardKey,
    buildCommentRewardKey,
    TASK_REWARD_MAX_GOLD,
    COMMENT_REWARD_MAX_GOLD,
    OPEN_STEP,
    DONE_STEP,
} = require('./serverGoldRewards')
const { getObjectDocPath } = require('../shared/privacyAccess')

const repoRoot = path.join(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8')
const NOW = Date.UTC(2026, 10, 8, 22, 30) // 23:30 in Berlin, already the 9th in Tokyo

const openTask = overrides => ({
    userId: 'owner',
    userIds: ['owner'],
    currentReviewerId: 'owner',
    stepHistory: [OPEN_STEP],
    done: false,
    ...overrides,
})

describe('which task updates pay a reward', () => {
    test('completing an open task pays its owner, once per step', () => {
        const reward = resolveTaskProgressReward(
            't1',
            openTask(),
            openTask({ done: true, currentReviewerId: DONE_STEP, completed: 2 })
        )
        expect(reward).toMatchObject({ recipientId: 'owner', ownerId: 'owner' })
        expect(reward.rewardKey).toBe('task_progress:t1:1:owner')
        expect(reward.gold).toBe(getRewardGoldAmount(TASK_REWARD_MAX_GOLD, reward.rewardKey))
        expect(reward.gold).toBeGreaterThanOrEqual(1)
        expect(reward.gold).toBeLessThanOrEqual(TASK_REWARD_MAX_GOLD)
    })

    test('reopening and completing again names the same reward, so it is paid once', () => {
        const first = resolveTaskProgressReward('t1', openTask(), openTask({ done: true, completed: 2 }))
        const again = resolveTaskProgressReward(
            't1',
            openTask({ completed: 3 }),
            openTask({ done: true, completed: 4 })
        )
        expect(again.rewardKey).toBe(first.rewardKey)
    })

    test('leaving a workflow step pays the reviewer of that step', () => {
        const before = openTask({ userIds: ['owner', 'rev'], currentReviewerId: 'rev', stepHistory: [OPEN_STEP, 's1'] })
        const after = openTask({ done: true, currentReviewerId: DONE_STEP })
        expect(resolveTaskProgressReward('t1', before, after)).toMatchObject({
            recipientId: 'rev',
            ownerId: null,
            rewardKey: 'task_progress:t1:2:rev',
        })
    })

    test.each([
        ['a subtask', openTask(), openTask({ done: true, parentId: 'p' })],
        ['a reopened task', openTask({ done: true }), openTask()],
        ['a task moved back a step', openTask({ stepHistory: [OPEN_STEP, 's1'] }), openTask()],
        ['an edit that moves nothing', openTask(), openTask({ name: 'renamed' })],
        ['a done task edited', openTask({ done: true }), openTask({ done: true, name: 'x' })],
    ])('%s pays nothing', (_, before, after) => {
        expect(resolveTaskProgressReward('t1', before, after)).toBeNull()
    })
})

describe('paying a task reward', () => {
    const seed = extra =>
        createFirestoreDouble({
            'projects/p1': { userIds: ['owner', 'rev'] },
            'users/owner': { timezone: 1 },
            'users/rev': { timezone: 'Asia/Tokyo' },
            ...extra,
        })

    test('pays through earnGold with the key, the source and the recipient’s local day', async () => {
        const earnGold = jest.fn(async () => ({ success: true }))
        await awardTaskProgressGold({
            db: seed(),
            earnGold,
            projectId: 'p1',
            taskId: 't1',
            before: openTask(),
            after: openTask({ done: true }),
            now: NOW,
        })
        const key = buildTaskProgressRewardKey('t1', 1, 'owner')
        expect(earnGold).toHaveBeenCalledWith(
            'p1',
            'owner',
            getRewardGoldAmount(TASK_REWARD_MAX_GOLD, key),
            '08112026',
            NOW,
            20261108,
            { rewardKey: key, objectId: 't1', objectType: 'task', source: 'task_completion' }
        )
    })

    test('books on the reviewer’s own local day', async () => {
        const earnGold = jest.fn(async () => ({ success: true }))
        await awardTaskProgressGold({
            db: seed(),
            earnGold,
            projectId: 'p1',
            taskId: 't1',
            before: openTask({ currentReviewerId: 'rev', stepHistory: [OPEN_STEP, 's1'] }),
            after: openTask({ done: true }),
            now: NOW,
        })
        expect(earnGold.mock.calls[0].slice(3, 6)).toEqual(['09112026', NOW, 20261109])
    })

    test.each([
        [
            'a recipient outside the project',
            openTask({ userId: 'stranger' }),
            openTask({ userId: 'stranger', done: true }),
        ],
        ['a workstream-owned task', openTask({ userId: 'ws@team' }), openTask({ userId: 'owner', done: true })],
        [
            'an assistant reviewing a step',
            openTask({ currentReviewerId: 'assistant-1', stepHistory: [OPEN_STEP, 's1'] }),
            openTask({ done: true }),
        ],
    ])('pays nothing to %s', async (_, before, after) => {
        const earnGold = jest.fn()
        await awardTaskProgressGold({ db: seed(), earnGold, projectId: 'p1', taskId: 't1', before, after, now: NOW })
        expect(earnGold).not.toHaveBeenCalled()
    })
})

describe('paying a comment reward in a guide', () => {
    const seed = extra =>
        createFirestoreDouble({
            'projects/guide': { userIds: ['member'], parentTemplateId: 'template-1' },
            'projects/plain': { userIds: ['member'] },
            'users/member': {},
            'items/guide/tasks/public': { isPublicFor: [0, 'member'] },
            'items/guide/tasks/private': { isPublicFor: ['member'] },
            'items/plain/tasks/public': { isPublicFor: [0, 'member'] },
            ...extra,
        })
    const award = (overrides = {}) => {
        const earnGold = jest.fn(async () => ({ success: true }))
        const promise = awardCommentGold({
            db: seed(),
            earnGold,
            getObjectDocPath,
            projectId: 'guide',
            objectType: 'tasks',
            objectId: 'public',
            commentId: 'c1',
            comment: { creatorId: 'member', commentText: 'hi' },
            now: NOW,
            ...overrides,
        })
        return promise.then(result => ({ result, earnGold }))
    }

    test('pays a member for a comment on a project-visible object', async () => {
        const { earnGold } = await award()
        const key = buildCommentRewardKey('tasks', 'public', 'c1')
        expect(earnGold).toHaveBeenCalledWith(
            'guide',
            'member',
            getRewardGoldAmount(COMMENT_REWARD_MAX_GOLD, key),
            expect.any(String),
            NOW,
            expect.any(Number),
            { rewardKey: key, objectId: 'public', objectType: 'tasks', source: 'guide_comment' }
        )
    })

    test.each([
        ['a project that is not a guide', { projectId: 'plain' }],
        ['a private object', { objectId: 'private' }],
        ['a missing object', { objectId: 'gone' }],
        ['an assistant comment', { comment: { creatorId: 'member', fromAssistant: true } }],
        ['a comment by a non-member', { comment: { creatorId: 'stranger' } }],
        ['a comment without author', { comment: {} }],
    ])('pays nothing for %s', async (_, overrides) => {
        const { earnGold } = await award(overrides)
        expect(earnGold).not.toHaveBeenCalled()
    })
})

describe('the browser animation and the server agree', () => {
    test('the client uses the same amount hash and reward keys', () => {
        const firestore = read('utils/backends/firestore.js')
        const tasks = read('utils/backends/Tasks/tasksFirestore.js')
        const comments = read('utils/backends/Chats/chatsComments.js')
        const server = read('functions/Gold/serverGoldRewards.js')

        const body = (source, signature) => {
            const start = source.indexOf(signature)
            expect(start).toBeGreaterThan(-1)
            return source.slice(source.indexOf('{', start), source.indexOf('\n}\n', start)).replace(/\s+/g, ' ')
        }
        expect(body(firestore, 'export function getRewardGoldAmount(maxGold, rewardKey)')).toBe(
            body(server, 'function getRewardGoldAmount(maxGold, rewardKey)')
        )
        expect(tasks).toContain('return `task_progress:${taskId}:${stepIndex}:${recipientId}`')
        expect(server).toContain('return `task_progress:${taskId}:${stepIndex}:${recipientId}`')
        expect(comments).toContain('`comment:${objectType}:${objectId}:${commentId}`')
        expect(server).toContain('return `comment:${objectType}:${objectId}:${commentId}`')
    })

    test('the browser no longer asks the server to pay a reward', () => {
        const firestore = read('utils/backends/firestore.js')
        expect(firestore).not.toMatch(/runHttpsCallableFunction\('earnGoldSecondGen'/)
    })

    test('index.js grants rewards from the task and comment triggers', () => {
        const index = read('functions/index.js')
        const onUpdateTask = index.slice(
            index.indexOf('exports.onUpdateTaskSecondGen'),
            index.indexOf('exports.onCreateObjectCommentSecondGen')
        )
        expect(onUpdateTask).toContain('awardTaskProgressGoldIfChanged(event)')
        const onComment = index.slice(
            index.indexOf('exports.onCreateObjectCommentSecondGen'),
            index.indexOf('exports.onDeleteTaskSecondGen')
        )
        expect(onComment).toContain('awardCommentGold({')
    })
})
