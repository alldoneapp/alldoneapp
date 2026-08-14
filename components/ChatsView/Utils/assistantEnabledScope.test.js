import {
    buildAssistantEnabledScope,
    isAssistantEnabledScopeMatch,
    normalizeAssistantEnabledScope,
    selectAssistantEnabledFor,
} from './assistantEnabledScope'
import { setAssistantEnabled } from '../../../redux/actions'

const PROJECT_ID = 'project-1'
const CHAT_ID = 'chat-1'
const OTHER_CHAT_ID = 'task-created-from-my-day'

describe('assistantEnabledScope', () => {
    describe('buildAssistantEnabledScope', () => {
        it('builds a chat-scoped marker', () => {
            expect(buildAssistantEnabledScope(PROJECT_ID, CHAT_ID)).toEqual({
                projectId: PROJECT_ID,
                objectId: CHAT_ID,
            })
        })

        it('returns null when the target chat is unknown', () => {
            expect(buildAssistantEnabledScope(PROJECT_ID, '')).toBeNull()
            expect(buildAssistantEnabledScope('', CHAT_ID)).toBeNull()
            expect(buildAssistantEnabledScope(undefined, undefined)).toBeNull()
        })
    })

    describe('normalizeAssistantEnabledScope', () => {
        it('keeps only the identity fields', () => {
            expect(normalizeAssistantEnabledScope({ projectId: PROJECT_ID, objectId: CHAT_ID, extra: 'x' })).toEqual({
                projectId: PROJECT_ID,
                objectId: CHAT_ID,
            })
        })

        it('normalizes anything that is not a complete scope to null', () => {
            expect(normalizeAssistantEnabledScope(null)).toBeNull()
            expect(normalizeAssistantEnabledScope(true)).toBeNull()
            expect(normalizeAssistantEnabledScope('chat-1')).toBeNull()
            expect(normalizeAssistantEnabledScope({ projectId: PROJECT_ID })).toBeNull()
            expect(normalizeAssistantEnabledScope({ objectId: CHAT_ID })).toBeNull()
        })
    })

    describe('isAssistantEnabledScopeMatch', () => {
        it('honors an unscoped flag everywhere (the in-chat writers)', () => {
            expect(isAssistantEnabledScopeMatch(null, PROJECT_ID, CHAT_ID)).toBe(true)
            expect(isAssistantEnabledScopeMatch(undefined, PROJECT_ID, CHAT_ID)).toBe(true)
        })

        it('honors a scoped flag in the chat it was armed for', () => {
            const scope = buildAssistantEnabledScope(PROJECT_ID, CHAT_ID)

            expect(isAssistantEnabledScopeMatch(scope, PROJECT_ID, CHAT_ID)).toBe(true)
        })

        // AT-2084: a pre-config run started with skipNavigation must not switch the assistant on
        // in whatever chat the user happens to open next.
        it('rejects a flag armed for a different chat', () => {
            const scope = buildAssistantEnabledScope(PROJECT_ID, OTHER_CHAT_ID)

            expect(isAssistantEnabledScopeMatch(scope, PROJECT_ID, CHAT_ID)).toBe(false)
        })

        it('rejects a flag armed for a chat of another project', () => {
            const scope = buildAssistantEnabledScope('other-project', CHAT_ID)

            expect(isAssistantEnabledScopeMatch(scope, PROJECT_ID, CHAT_ID)).toBe(false)
        })

        it('rejects a scoped flag when the reader does not know which chat it renders', () => {
            const scope = buildAssistantEnabledScope(PROJECT_ID, CHAT_ID)

            expect(isAssistantEnabledScopeMatch(scope, PROJECT_ID, undefined)).toBe(false)
            expect(isAssistantEnabledScopeMatch(scope, undefined, CHAT_ID)).toBe(false)
        })
    })

    describe('selectAssistantEnabledFor', () => {
        it('is false when the assistant is globally off', () => {
            const state = { assistantEnabled: false, assistantEnabledScope: null }

            expect(selectAssistantEnabledFor(state, PROJECT_ID, CHAT_ID)).toBe(false)
        })

        it('is true for an unscoped flag', () => {
            const state = { assistantEnabled: true, assistantEnabledScope: null }

            expect(selectAssistantEnabledFor(state, PROJECT_ID, CHAT_ID)).toBe(true)
        })

        it('is true in the chat the flag was armed for', () => {
            const state = {
                assistantEnabled: true,
                assistantEnabledScope: buildAssistantEnabledScope(PROJECT_ID, CHAT_ID),
            }

            expect(selectAssistantEnabledFor(state, PROJECT_ID, CHAT_ID)).toBe(true)
        })

        it('is false in an unrelated chat', () => {
            const state = {
                assistantEnabled: true,
                assistantEnabledScope: buildAssistantEnabledScope(PROJECT_ID, OTHER_CHAT_ID),
            }

            expect(selectAssistantEnabledFor(state, PROJECT_ID, CHAT_ID)).toBe(false)
        })
    })

    describe('setAssistantEnabled action creator', () => {
        it('stays unscoped when no scope is passed (every in-chat writer)', () => {
            expect(setAssistantEnabled(true)).toEqual({
                type: 'Set assistant enabled',
                assistantEnabled: true,
                assistantEnabledScope: null,
            })
        })

        it('carries a valid scope', () => {
            expect(setAssistantEnabled(true, buildAssistantEnabledScope(PROJECT_ID, CHAT_ID))).toEqual({
                type: 'Set assistant enabled',
                assistantEnabled: true,
                assistantEnabledScope: { projectId: PROJECT_ID, objectId: CHAT_ID },
            })
        })

        it('drops an incomplete scope instead of storing a half-identified one', () => {
            expect(setAssistantEnabled(true, { projectId: PROJECT_ID }).assistantEnabledScope).toBeNull()
        })

        // A scope that outlived the `true` it described would make a later unscoped `true` look
        // like it belonged to that chat.
        it('clears the scope whenever the flag is switched off', () => {
            expect(setAssistantEnabled(false, buildAssistantEnabledScope(PROJECT_ID, CHAT_ID))).toEqual({
                type: 'Set assistant enabled',
                assistantEnabled: false,
                assistantEnabledScope: null,
            })
        })
    })
})
