const {
    MAX_ARTIFACT_TIMESTAMP,
    MIN_ARTIFACT_TIMESTAMP,
    firstArtifactTimestamp,
    toArtifactTimestamp,
} = require('./artifactDates')
const { mergeLinkedUploads } = require('./linkedUploadsModel')

// A real date in Alldone's lifetime: 11 Jan 2023 19:45:25 UTC, the screenshot in the AT-2887 report.
const T = Date.UTC(2023, 0, 11, 19, 45, 25)

describe('toArtifactTimestamp', () => {
    it('keeps epoch milliseconds as they are', () => {
        expect(toArtifactTimestamp(T)).toBe(T)
        expect(toArtifactTimestamp(String(T))).toBe(T)
    })

    it('treats the legacy MAX_SAFE_INTEGER sentinel as unknown, not as a date (AT-2887)', () => {
        // The value production tasks from 2020 carry; moment renders it as "Invalid date".
        expect(toArtifactTimestamp(9007199254740991)).toBe(0)
        expect(toArtifactTimestamp(Number.MAX_SAFE_INTEGER)).toBe(0)
        expect(toArtifactTimestamp('9007199254740991')).toBe(0)
    })

    it('reads Firestore Timestamps, in every shape they arrive in', () => {
        const seconds = T / 1000
        expect(toArtifactTimestamp({ toMillis: () => T })).toBe(T)
        expect(toArtifactTimestamp({ seconds, nanoseconds: 500000000 })).toBe(T + 500)
        expect(toArtifactTimestamp({ _seconds: seconds, _nanoseconds: 0 })).toBe(T)
        expect(toArtifactTimestamp({ toMillis: () => Number.MAX_SAFE_INTEGER })).toBe(0)
        expect(
            toArtifactTimestamp({
                toMillis: () => {
                    throw new Error('broken')
                },
            })
        ).toBe(0)
    })

    it('reads epoch seconds, Date objects and ISO strings', () => {
        expect(toArtifactTimestamp(T / 1000)).toBe(T)
        expect(toArtifactTimestamp(new Date(T))).toBe(T)
        expect(toArtifactTimestamp(new Date(T).toISOString())).toBe(T)
    })

    it('answers 0 for everything that is not a trustworthy time', () => {
        for (const value of [
            undefined,
            null,
            '',
            '   ',
            0,
            -1,
            1,
            NaN,
            Infinity,
            true,
            'Invalid date',
            'abc',
            {},
            [],
            new Date(NaN),
            MIN_ARTIFACT_TIMESTAMP - 1,
            MAX_ARTIFACT_TIMESTAMP + 1,
            T * 1000, // microseconds
        ]) {
            expect(toArtifactTimestamp(value)).toBe(0)
        }
    })
})

describe('firstArtifactTimestamp', () => {
    it('falls back to the next candidate when one is a sentinel or missing', () => {
        expect(firstArtifactTimestamp(Number.MAX_SAFE_INTEGER, T)).toBe(T)
        expect(firstArtifactTimestamp(undefined, null, T)).toBe(T)
        expect(firstArtifactTimestamp(T + 1, T)).toBe(T + 1)
        expect(firstArtifactTimestamp(Number.MAX_SAFE_INTEGER, undefined)).toBe(0)
        expect(firstArtifactTimestamp()).toBe(0)
    })
})

describe('mergeLinkedUploads with legacy dates', () => {
    const reference = path => ({ path, url: `https://example.test/${path}` })

    it('never lets a sentinel date outrank a real one, and orders unknown dates last', () => {
        const files = mergeLinkedUploads([
            {
                references: [reference('attachments/a/legacy.png')],
                source: { type: 'tasks', id: 'legacy' },
                date: Number.MAX_SAFE_INTEGER,
                isPrivate: false,
            },
            {
                references: [reference('attachments/b/new.png')],
                source: { type: 'tasks', id: 'new' },
                date: T,
                isPrivate: false,
            },
            {
                references: [reference('attachments/a/legacy.png')],
                source: { type: 'notes', id: 'note' },
                date: T - 1000,
                isPrivate: false,
            },
        ])
        expect(files.map(file => [file.title, file.lastEditionDate])).toEqual([
            ['new.png', T],
            ['legacy.png', T - 1000],
        ])

        const onlySentinel = mergeLinkedUploads([
            {
                references: [reference('attachments/c/only.png')],
                source: { type: 'tasks', id: 'legacy' },
                date: Number.MAX_SAFE_INTEGER,
                isPrivate: false,
            },
        ])
        expect(onlySentinel[0].lastEditionDate).toBe(0)
    })
})
