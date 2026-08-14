import { BOT_SPINNER_TRIGGER_TTL_MS, buildBotSpinnerTrigger, shouldConsumeBotSpinnerTrigger } from './botSpinnerTrigger'
import { setTriggerBotSpinner } from '../../../redux/actions'

const PROJECT_ID = 'project-1'
const CHAT_ID = 'chat-1'
const NOW = 1_700_000_000_000

describe('botSpinnerTrigger', () => {
    describe('buildBotSpinnerTrigger', () => {
        it('builds a chat-scoped, timestamped trigger', () => {
            expect(buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)).toEqual({
                projectId: PROJECT_ID,
                chatId: CHAT_ID,
                createdAt: NOW,
            })
        })

        it('returns null when the target chat is unknown', () => {
            expect(buildBotSpinnerTrigger(PROJECT_ID, '', NOW)).toBeNull()
            expect(buildBotSpinnerTrigger('', CHAT_ID, NOW)).toBeNull()
            expect(buildBotSpinnerTrigger(undefined, undefined, NOW)).toBeNull()
        })
    })

    describe('shouldConsumeBotSpinnerTrigger', () => {
        it('shows the placeholder in the chat the trigger targets', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)

            expect(shouldConsumeBotSpinnerTrigger(trigger, PROJECT_ID, CHAT_ID, NOW + 1000)).toBe(true)
        })

        // AT-2084: a run started from My Day / the pre-config search modal (skipNavigation)
        // must never make an unrelated task chat claim the assistant is working.
        it('never shows the placeholder in a different chat', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, 'quick-topic-created-in-my-day', NOW)

            expect(shouldConsumeBotSpinnerTrigger(trigger, PROJECT_ID, 'some-other-task', NOW)).toBe(false)
        })

        it('never shows the placeholder in a chat of another project', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)

            expect(shouldConsumeBotSpinnerTrigger(trigger, 'project-2', CHAT_ID, NOW)).toBe(false)
        })

        it('ignores legacy unscoped boolean triggers', () => {
            expect(shouldConsumeBotSpinnerTrigger(true, PROJECT_ID, CHAT_ID, NOW)).toBe(false)
            expect(shouldConsumeBotSpinnerTrigger('true', PROJECT_ID, CHAT_ID, NOW)).toBe(false)
        })

        it('ignores an empty trigger', () => {
            expect(shouldConsumeBotSpinnerTrigger(null, PROJECT_ID, CHAT_ID, NOW)).toBe(false)
            expect(shouldConsumeBotSpinnerTrigger(undefined, PROJECT_ID, CHAT_ID, NOW)).toBe(false)
            expect(shouldConsumeBotSpinnerTrigger(false, PROJECT_ID, CHAT_ID, NOW)).toBe(false)
        })

        it('ignores a trigger when the chat identity is unknown', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)

            expect(shouldConsumeBotSpinnerTrigger(trigger, PROJECT_ID, undefined, NOW)).toBe(false)
            expect(shouldConsumeBotSpinnerTrigger(trigger, undefined, CHAT_ID, NOW)).toBe(false)
        })

        it('expires a trigger whose chat was never opened in time', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)

            expect(shouldConsumeBotSpinnerTrigger(trigger, PROJECT_ID, CHAT_ID, NOW + BOT_SPINNER_TRIGGER_TTL_MS)).toBe(
                true
            )
            expect(
                shouldConsumeBotSpinnerTrigger(trigger, PROJECT_ID, CHAT_ID, NOW + BOT_SPINNER_TRIGGER_TTL_MS + 1)
            ).toBe(false)
        })

        it('accepts a trigger without a timestamp', () => {
            expect(
                shouldConsumeBotSpinnerTrigger({ projectId: PROJECT_ID, chatId: CHAT_ID }, PROJECT_ID, CHAT_ID, NOW)
            ).toBe(true)
        })
    })

    describe('setTriggerBotSpinner action', () => {
        it('keeps a chat-scoped trigger', () => {
            const trigger = buildBotSpinnerTrigger(PROJECT_ID, CHAT_ID, NOW)

            expect(setTriggerBotSpinner(trigger).triggerBotSpinner).toEqual(trigger)
        })

        it('normalizes unscoped payloads to null so they cannot leak into another chat', () => {
            expect(setTriggerBotSpinner(true).triggerBotSpinner).toBeNull()
            expect(setTriggerBotSpinner(false).triggerBotSpinner).toBeNull()
            expect(setTriggerBotSpinner(null).triggerBotSpinner).toBeNull()
            expect(setTriggerBotSpinner({ projectId: PROJECT_ID }).triggerBotSpinner).toBeNull()
        })
    })
})
