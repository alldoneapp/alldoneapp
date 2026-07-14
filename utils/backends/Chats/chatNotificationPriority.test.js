import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY, getProjectChatLastNotification } from './chatNotificationPriority'

const notification = (chatId, followed, date, extra = {}) => ({
    chatId,
    chatType: 'topics',
    followed,
    date,
    ...extra,
})

describe('getProjectChatLastNotification', () => {
    it('keeps red notifications ahead of newer grey notifications', () => {
        const olderRed = notification('older-red-chat', true, 100)
        const newerRed = notification('newer-red-chat', true, 150)
        const grey = notification('grey-chat', false, 200)

        const result = getProjectChatLastNotification('project-1', [olderRed, grey, newerRed], {})

        expect(result['project-1']).toBe(newerRed)
    })

    it('uses the newest grey notification when there is no red notification', () => {
        const olderGrey = notification('older-grey-chat', false, 100)
        const newerGrey = notification('newer-grey-chat', false, 200)

        const result = getProjectChatLastNotification('project-1', [olderGrey, newerGrey], {})

        expect(result['project-1']).toBe(newerGrey)
    })

    it('uses priority before timestamps across all projects', () => {
        const red = notification('red-chat', true, 100)
        const grey = notification('grey-chat', false, 200)
        const existing = getProjectChatLastNotification('red-project', [red], {})

        const result = getProjectChatLastNotification('grey-project', [grey], existing)

        expect(result[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]).toEqual({
            ...red,
            projectId: 'red-project',
        })
    })

    it('prefers red for equal timestamps and otherwise keeps the first equal notification', () => {
        const grey = notification('grey-chat', false, 100)
        const red = notification('red-chat', true, 100)
        const secondRed = notification('second-red-chat', true, 100)

        const result = getProjectChatLastNotification('project-1', [grey, red, secondRed], {})

        expect(result['project-1']).toBe(red)
    })

    it('handles empty input, missing dates, and unrelated notification metadata', () => {
        const emptyResult = getProjectChatLastNotification('project-1', null, null)
        expect(emptyResult['project-1']).toBeNull()
        expect(emptyResult[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]).toBeNull()

        const missingDate = notification('missing-date', false, null, { color: 'blue', type: 'system' })
        const datedGrey = notification('dated-grey', false, 100)
        const result = getProjectChatLastNotification('project-1', [missingDate, datedGrey], {})

        expect(result['project-1']).toBe(datedGrey)
    })
})
