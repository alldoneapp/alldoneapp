/**
 * AT-3156: every function instance loads the whole of `index.js`, so whatever its modules require
 * at module scope is paid on the cold start of every function, not only of the one that uses it.
 * Moving the meeting transcription's Deepgram client and the assistant chat module (with its
 * tiktoken encoder) to first use halved the load time of `index.js`. These checks keep them there.
 */
const fs = require('fs')
const path = require('path')

const read = relative => fs.readFileSync(path.join(__dirname, relative), 'utf8')

// Only requires that run at module scope: not indented (inside a function body), and not the body
// of an arrow function such as `const load = () => require(...)`, which runs on first call.
const moduleScopeRequires = source =>
    source
        .split('\n')
        .filter(line => /^(const|let|var|exports\.)[^=]*=\s*require\(/.test(line))
        .join('\n')

describe('cold start: modules index.js must not load at module scope', () => {
    it('loads the assistant chat module only when askToBot runs', () => {
        const topLevel = moduleScopeRequires(read('index.js'))

        expect(topLevel).not.toMatch(/assistantNormalTalk_optimized/)
        expect(topLevel).not.toMatch(/assistantPreConfigTaskTopic/)
    })

    it('registers the meeting transcription callable without loading Deepgram or the Gold ledger', () => {
        jest.isolateModules(() => {
            jest.doMock('firebase-functions/v2/https', () => ({ onCall: (_, handler) => handler, HttpsError: Error }))
            const loadDeepgram = jest.fn(() => ({ transcribeAudioBase64: jest.fn() }))
            const loadGold = jest.fn(() => ({ deductGold: jest.fn() }))
            jest.doMock('./Notes/deepgramTranscribe', loadDeepgram)
            jest.doMock('./Gold/goldHelper', loadGold)

            const { transcribeMeetingAudio } = require('./Notes/transcribeMeeting')

            expect(typeof transcribeMeetingAudio).toBe('function')
            expect(loadDeepgram).not.toHaveBeenCalled()
            expect(loadGold).not.toHaveBeenCalled()
        })
    })
})
