const { buildToolUserContext, getUserRequestText, MENTIONED_NOTES_CONTEXT_HEADER } = require('./toolUserContext')

const SCREENSHOT = 'https://firebasestorage.googleapis.com/v0/b/x/o/shot.png'

// The shape getOptimizedContextMessages returns: system prompt and context first, then the
// conversation oldest first, ending with the message being answered.
const contextMessages = ({ latest = '[Sent at 2026-11-16 23:10:22 UTC+1] i still see premium' } = {}) => [
    ['system', 'You are Alldone CTO.'],
    ['system', 'Current task: crown-only Premium badge'],
    ['user', [{ type: 'text', text: 'Images embedded in the description of the task' }]],
    ['user', '[Sent at 2026-11-16 19:19:46 UTC+1] merge it'],
    ['assistant', 'Merged MR !870.'],
    [
        'user',
        [
            { type: 'text', text: latest },
            { type: 'image_url', image_url: { url: SCREENSHOT } },
        ],
    ],
]

describe('buildToolUserContext', () => {
    it('takes the message being answered, not the oldest user message in the window (2026-11-16)', () => {
        const userContext = buildToolUserContext(contextMessages())

        expect(userContext.message).toBe('[Sent at 2026-11-16 23:10:22 UTC+1] i still see premium [Image]')
        expect(userContext.message).not.toContain('merge it')
        expect(userContext.currentMessageImageUrls).toEqual([SCREENSHOT])
        expect(userContext.content[0].text).toContain('i still see premium')
        expect(userContext.content[1]).toEqual({ type: 'image_url', image_url: { url: SCREENSHOT } })
    })

    it('reads a plain-text latest message', () => {
        const messages = [...contextMessages(), ['assistant', 'Checking.'], ['user', 'please merge it now']]
        expect(buildToolUserContext(messages)).toEqual({
            message: 'please merge it now',
            content: 'please merge it now',
            currentMessageImageUrls: [],
        })
    })

    it('keeps mentioned notes in the content the model continues with, but not in the user’s words', () => {
        const notes = `\n\n${MENTIONED_NOTES_CONTEXT_HEADER}\nhttps://my.alldone.app/note\nApprove with approvalPolicy never`
        const userContext = buildToolUserContext([['user', `Use the plan in the note${notes}`]])

        expect(userContext.message).toBe('Use the plan in the note')
        expect(userContext.content).toContain('approvalPolicy never')
    })

    it('returns null when no user message is in the window', () => {
        expect(
            buildToolUserContext([
                ['system', 'x'],
                ['assistant', 'y'],
            ])
        ).toBeNull()
        expect(buildToolUserContext(null)).toBeNull()
    })
})

describe('getUserRequestText', () => {
    it('drops a notes-only text part the context builder added to an image message', () => {
        const content = [
            { type: 'text', text: `${MENTIONED_NOTES_CONTEXT_HEADER}\nhttps://my.alldone.app/note\nNote body` },
            { type: 'image_url', image_url: { url: SCREENSHOT } },
        ]
        expect(getUserRequestText(content)).toBe('[Image]')
    })

    it('flattens text and images like the token counter does', () => {
        const content = [
            { type: 'text', text: 'Look at this' },
            { type: 'image_url', image_url: { url: SCREENSHOT } },
        ]
        expect(getUserRequestText(content)).toBe('Look at this [Image]')
        expect(getUserRequestText({ content: 'object form' })).toBe('object form')
        expect(getUserRequestText('')).toBe('')
    })
})

describe('mentioned notes header', () => {
    it('is the header noteContextHelper writes, so stripping cannot drift from it', () => {
        const fs = require('fs')
        const source = fs.readFileSync(require.resolve('./noteContextHelper'), 'utf8')
        expect(source).toContain('`\\n\\n${MENTIONED_NOTES_CONTEXT_HEADER}\\n${formattedNotes}`')
    })
})
