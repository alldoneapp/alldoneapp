jest.mock('../i18n/TranslationService', () => ({
    translate: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
}))

const {
    confirmPreConfigTaskRunFromLink,
    PROMPT_PREVIEW_MAX_LENGTH,
    viewerAuthoredPreConfigTask,
} = require('./preConfigTaskRunConfirmation')

describe('confirming a pre-configured task run from a link (security audit 2026-11)', () => {
    it('runs the viewer’s own prompt without asking', () => {
        const confirm = jest.fn()
        expect(confirmPreConfigTaskRunFromLink({ creatorUserId: 'me', prompt: 'x' }, 'me', confirm)).toBe(true)
        expect(confirm).not.toHaveBeenCalled()
    })

    it('asks before running a prompt someone else wrote, or one with no recorded author, and shows it', () => {
        const confirm = jest.fn(() => false)
        expect(
            confirmPreConfigTaskRunFromLink({ creatorUserId: 'other', name: 'N', prompt: 'P1' }, 'me', confirm)
        ).toBe(false)
        expect(confirmPreConfigTaskRunFromLink({ name: 'N', prompt: 'P2' }, 'me', confirm)).toBe(false)
        expect(confirm.mock.calls[0][0]).toContain('P1')
        expect(confirm.mock.calls[1][0]).toContain('P2')
    })

    it('trims a very long prompt in the question', () => {
        const confirm = jest.fn(() => true)
        confirmPreConfigTaskRunFromLink({ prompt: 'a'.repeat(PROMPT_PREVIEW_MAX_LENGTH + 500) }, 'me', confirm)
        expect(confirm.mock.calls[0][0].length).toBeLessThan(PROMPT_PREVIEW_MAX_LENGTH + 200)
    })

    it('never treats a missing viewer as the author', () => {
        expect(viewerAuthoredPreConfigTask({ creatorUserId: undefined }, undefined)).toBe(false)
        expect(confirmPreConfigTaskRunFromLink({ prompt: 'x' }, undefined, null)).toBe(false)
    })
})
