const {
    TASK_DESCRIPTION_MAX_CONTEXT_IMAGES,
    sanitizeTaskDescriptionText,
    extractTaskDescriptionMedia,
    extractTaskDescriptionImageUrls,
    buildTaskDescriptionMediaContextLines,
} = require('./taskDescriptionContext')

const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'

const imageToken = (uri, resizedUri, label) =>
    `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${label}${IMAGE_TRIGGER}0`
const attachmentToken = (uri, label) =>
    `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${label}${ATTACHMENT_TRIGGER}false`
const videoToken = (uri, label) => `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${label}${VIDEO_TRIGGER}false`

// Shape taken from a real production task description (project Alldone Product).
const MOCKUP_IMAGE =
    'https://firebasestorage.googleapis.com/v0/b/alldonealeph.appspot.com/o/feedAttachments%2Fmock.png?alt=media&token=abc'
const MOCKUP_PREVIEW =
    'https://firebasestorage.googleapis.com/v0/b/alldonealeph.appspot.com/o/feedAttachments%2Fprev?alt=media&token=def'

describe('sanitizeTaskDescriptionText', () => {
    test('replaces media tokens with their human label', () => {
        const description = `Build ${imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png')} exactly.`

        expect(sanitizeTaskDescriptionText(description)).toBe('Build mock.png exactly.')
    })

    test('preserves the text that follows a token on the next line', () => {
        // Regression guard: the shared cleanTextMetaData splits on a literal space, so a token
        // directly followed by a newline swallows the rest of that line.
        const description = `${imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png')}\nBuild this screen.`

        expect(sanitizeTaskDescriptionText(description)).toBe('mock.png\nBuild this screen.')
    })

    test('labels attachments and videos too', () => {
        const description = `${attachmentToken('https://storage.example/spec.pdf', 'spec.pdf')} and ${videoToken(
            'https://storage.example/demo.mp4',
            'demo.mp4'
        )}`

        expect(sanitizeTaskDescriptionText(description)).toBe('spec.pdf and demo.mp4')
    })

    test('leaves plain descriptions and non-string input alone', () => {
        expect(sanitizeTaskDescriptionText('Just plain text.')).toBe('Just plain text.')
        expect(sanitizeTaskDescriptionText('')).toBe('')
        expect(sanitizeTaskDescriptionText(null)).toBe('')
        expect(sanitizeTaskDescriptionText(undefined)).toBe('')
    })
})

describe('extractTaskDescriptionMedia', () => {
    test('returns structured media for images and attachments', () => {
        const description = `${imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png')}\nBuild this.\n${attachmentToken(
            'https://storage.example/spec.pdf',
            'spec.pdf'
        )}`

        expect(extractTaskDescriptionMedia(description)).toEqual([
            expect.objectContaining({
                kind: 'image',
                fileName: 'mock.png',
                mimeType: 'image/png',
                storageUrl: MOCKUP_IMAGE,
                previewUrl: MOCKUP_PREVIEW,
            }),
            expect.objectContaining({
                kind: 'file',
                fileName: 'spec.pdf',
                mimeType: 'application/pdf',
                storageUrl: 'https://storage.example/spec.pdf',
            }),
        ])
    })

    test('returns nothing for a description without media', () => {
        expect(extractTaskDescriptionMedia('Nothing embedded here.')).toEqual([])
        expect(extractTaskDescriptionMedia(null)).toEqual([])
    })
})

describe('extractTaskDescriptionImageUrls', () => {
    test('returns only image urls, deduplicated', () => {
        const description = [
            imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png'),
            imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png'),
            attachmentToken('https://storage.example/spec.pdf', 'spec.pdf'),
        ].join('\n')

        expect(extractTaskDescriptionImageUrls(description)).toEqual([MOCKUP_IMAGE])
    })

    test('caps how many images are turned into vision blocks', () => {
        const description = Array.from({ length: TASK_DESCRIPTION_MAX_CONTEXT_IMAGES + 3 }, (_, index) =>
            imageToken(
                `https://storage.example/img-${index}.png`,
                `https://storage.example/img-${index}-small.png`,
                `img-${index}.png`
            )
        ).join('\n')

        expect(extractTaskDescriptionImageUrls(description)).toHaveLength(TASK_DESCRIPTION_MAX_CONTEXT_IMAGES)
    })
})

describe('buildTaskDescriptionMediaContextLines', () => {
    test('lists every embedded file with a downloadable url', () => {
        const description = `${imageToken(MOCKUP_IMAGE, MOCKUP_PREVIEW, 'mock.png')}\nBuild this.\n${attachmentToken(
            'https://storage.example/spec.pdf',
            'spec.pdf'
        )}`

        expect(buildTaskDescriptionMediaContextLines(description)).toBe(
            'Files embedded in the task description (downloadable via the URLs):\n' +
                `- mock.png (image/png): ${MOCKUP_IMAGE}\n` +
                '- spec.pdf (application/pdf): https://storage.example/spec.pdf'
        )
    })

    test('is empty when the description has no media', () => {
        expect(buildTaskDescriptionMediaContextLines('Plain description.')).toBe('')
        expect(buildTaskDescriptionMediaContextLines('')).toBe('')
    })
})
