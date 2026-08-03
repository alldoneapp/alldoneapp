import { getAssistantTaskIcon, isScheduledAssistantTask } from './assistantTaskIcon'

describe('assistant-line pre-configured task icons', () => {
    test('uses the configured prompt chat icon for one-time prompt tasks', () => {
        expect(getAssistantTaskIcon({ type: 'prompt', recurrence: 'never' })).toBe('message-square')
    })

    test('uses the clock for scheduled prompt tasks', () => {
        expect(getAssistantTaskIcon({ type: 'prompt', recurrence: 'weekly' })).toBe('clock')
    })

    test('uses the clock when any member has an active schedule', () => {
        const task = {
            type: 'prompt',
            recurrence: 'never',
            recurrenceByUser: { 'user-1': 'never', 'user-2': 'daily' },
        }

        expect(isScheduledAssistantTask(task)).toBe(true)
        expect(getAssistantTaskIcon(task)).toBe('clock')
    })

    test('keeps the bookmark for links', () => {
        expect(getAssistantTaskIcon({ type: 'link', recurrence: 'never' })).toBe('bookmark')
    })

    test('gives scheduling precedence over the underlying link type', () => {
        expect(getAssistantTaskIcon({ type: 'link', recurrence: 'once' })).toBe('clock')
    })
})
