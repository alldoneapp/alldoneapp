/**
 * Migration Stage 4 regression suite: yjs 13.4.7 → 13.6.x document compatibility.
 *
 * The fixtures below are real `Y.encodeStateAsUpdate` blobs produced by yjs 13.4.7
 * (the version every production note was written with), shaped like Alldone notes:
 * the `quill` root text, the app's rich-text attributes, and its custom embeds.
 * Two of them deliberately carry 13.4.7's attribute-inheritance artifacts (a plain
 * insert next to formatted text picked up bold/color) because production docs do too.
 *
 * The EXPECTED deltas are what 13.4.7 itself decoded these blobs to — 13.6 must
 * read them identically, keep them stable across edit/persist/reload cycles, and
 * produce updates that a still-loaded 13.4.7 client could merge (verified once in
 * the migration scratchpad; the in-repo suite pins the 13.6 side).
 */
import * as Y from 'yjs'

const FIXTURES = {
    richText:
        'ARnh37L1DgAEAQVxdWlsbAxIZWFkaW5nIHRleHSG4d+y9Q4LBmhlYWRlcgExhOHfsvUODAEKhuHfsvUODQZoZWFkZXIEbnVsbIbh37L1Dg4EYm9sZAR0cnVlhOHfsvUODwVib2xkIIbh37L1DhQEYm9sZARudWxshuHfsvUOFQZpdGFsaWMEdHJ1ZYTh37L1DhYHaXRhbGljIIbh37L1Dh0GaXRhbGljBG51bGyG4d+y9Q4eBWNvbG9yCSIjQkQwMzAzIobh37L1Dh8KYmFja2dyb3VuZAkiI0ZGRTZDNyKE4d+y9Q4gB2NvbG9yZWSG4d+y9Q4nBWNvbG9yBG51bGyG4d+y9Q4oCmJhY2tncm91bmQEbnVsbMTh37L1Difh37L1DigZIHBsYWluIHRhaWwKbGlzdCBpdGVtIG9uZYbh37L1DikEbGlzdAgiYnVsbGV0IoTh37L1DkMBCobh37L1DkQEbGlzdARudWxsxOHfsvUOROHfsvUORQ1saXN0IGl0ZW0gdHdvxuHfsvUOUuHfsvUORQRsaXN0CSJvcmRlcmVkIsbh37L1DlPh37L1DkUGaW5kZW50ATHE4d+y9Q5U4d+y9Q5FAQrG4d+y9Q5V4d+y9Q5FBGxpc3QIImJ1bGxldCLG4d+y9Q5W4d+y9Q5FBmluZGVudARudWxsAA==',
    embeds: 'AQuv/bLQCgAEAQVxdWlsbAdiZWZvcmUgha/9stAKBkh7Im1lbnRpb24iOnsidGV4dCI6IkphbmVfRG9lIiwiaWQiOiJtMSIsInVzZXJJZCI6InU0MiIsImVkaXRvcklkIjoibjEifX2Er/2y0AoHBSBtaWQgha/9stAKDDZ7Imhhc2h0YWciOnsidGV4dCI6InRvcGljIiwiaWQiOiJoMSIsImVkaXRvcklkIjoibjEifX2Er/2y0AoNASCFr/2y0AoOjgF7InVybCI6eyJvcGVuIjpmYWxzZSwidXJsIjoiaHR0cHM6Ly9leGFtcGxlLmNvbS94IiwidHlwZSI6InBsYWluIiwidXJsQm91bmRhcnkiOiIiLCJpZCI6InUxIiwiZWRpdG9ySWQiOiJuMSIsInVzZXJJZEFsbG93ZWRUb0VkaXRUYWdzIjpmYWxzZX19hK/9stAKDwEgha/9stAKED97InRhc2tUYWdGb3JtYXQiOnsidGFza0lkIjoidGFzazkiLCJpZCI6InR0MSIsImVkaXRvcklkIjoibjEifX2Er/2y0AoRASCFr/2y0AoSkAF7ImN1c3RvbUltYWdlRm9ybWF0Ijp7InRleHQiOiJpbWcucG5nIiwidXJpIjoiaHR0cHM6Ly94L3kucG5nIiwicmVzaXplZFVyaSI6Imh0dHBzOi8veC95X3IucG5nIiwiaXNOZXciOiIwIiwiZXh0ZXJuYWxJZCI6ImNpMSIsImVkaXRvcklkIjoibjEifX2Er/2y0AoTAQoA',
    formatBoundaries:
        'AQvriJv2BgAGAQVxdWlsbARib2xkBHRydWWE64ib9gYAAmFihOuIm/YGAgJjZITriJv2BgQCZWaG64ib9gYGBGJvbGQEbnVsbMbriJv2BgLriJv2BgMEYm9sZARudWxsxuuIm/YGBOuIm/YGBQRib2xkBHRydWXG64ib9gYG64ib9gYHBnN0cmlrZQR0cnVlxOuIm/YGCuuIm/YGBwNnaGnG64ib9gYN64ib9gYHBnN0cmlrZQRudWxsxOuIm/YGDeuIm/YGDgEKAA==',
}

const EXPECTED = {
    richText: [
        { insert: 'Heading text' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: 'bold ', attributes: { bold: true } },
        { insert: 'italic ', attributes: { italic: true } },
        {
            insert: 'colored plain tail\nlist item one',
            attributes: { color: '#BD0303', background: '#FFE6C7' },
        },
        { insert: '\nlist item two', attributes: { list: 'bullet' } },
        { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
    ],
    embeds: [
        { insert: 'before ' },
        { insert: { mention: { text: 'Jane_Doe', id: 'm1', userId: 'u42', editorId: 'n1' } } },
        { insert: ' mid ' },
        { insert: { hashtag: { text: 'topic', id: 'h1', editorId: 'n1' } } },
        { insert: ' ' },
        {
            insert: {
                url: {
                    open: false,
                    url: 'https://example.com/x',
                    type: 'plain',
                    urlBoundary: '',
                    id: 'u1',
                    editorId: 'n1',
                    userIdAllowedToEditTags: false,
                },
            },
        },
        { insert: ' ' },
        { insert: { taskTagFormat: { taskId: 'task9', id: 'tt1', editorId: 'n1' } } },
        { insert: ' ' },
        {
            insert: {
                customImageFormat: {
                    text: 'img.png',
                    uri: 'https://x/y.png',
                    resizedUri: 'https://x/y_r.png',
                    isNew: '0',
                    externalId: 'ci1',
                    editorId: 'n1',
                },
            },
        },
        { insert: '\n' },
    ],
    formatBoundaries: [
        { insert: 'ab', attributes: { bold: true } },
        { insert: 'cd' },
        { insert: 'ef', attributes: { bold: true } },
        { insert: 'ghi\n', attributes: { bold: true, strike: true } },
    ],
}

const loadFixture = name => {
    const doc = new Y.Doc()
    const bytes = Uint8Array.from(atob(FIXTURES[name]), c => c.charCodeAt(0))
    Y.applyUpdate(doc, bytes)
    return doc
}

// jsdom in this jest version has no atob on the global in node scripts run outside
// the browserified env; keep a tiny fallback.
const atob = str => Buffer.from(str, 'base64').toString('binary')

describe('yjs 13.4.7-encoded notes under the upgraded yjs', () => {
    it.each(Object.keys(FIXTURES))('decodes the %s fixture to the exact 13.4.7 delta', name => {
        const doc = loadFixture(name)
        expect(doc.getText('quill').toDelta()).toEqual(EXPECTED[name])
    })

    it.each(Object.keys(FIXTURES))('persist/reload of %s is delta-identical and byte-stable', name => {
        const doc = loadFixture(name)
        const firstEncode = Y.encodeStateAsUpdate(doc)

        const reloaded = new Y.Doc()
        Y.applyUpdate(reloaded, firstEncode)
        expect(reloaded.getText('quill').toDelta()).toEqual(EXPECTED[name])

        const secondEncode = Y.encodeStateAsUpdate(reloaded)
        expect(Buffer.from(secondEncode).equals(Buffer.from(firstEncode))).toBe(true)
    })

    it('edits a 13.4.7 doc and round-trips the result', () => {
        const doc = loadFixture('richText')
        const text = doc.getText('quill')

        // Explicit-null attributes (the markdownToYjs / CLAUDE.md convention) must not
        // inherit neighbouring formatting under 13.6 either.
        text.insert(0, 'prefix ', { header: null, bold: null, color: null, background: null })
        text.format(7, 7, { bold: true })
        text.delete(19, 5)

        const persisted = Y.encodeStateAsUpdate(doc)
        const reloaded = new Y.Doc()
        Y.applyUpdate(reloaded, persisted)
        expect(reloaded.getText('quill').toDelta()).toEqual(text.toDelta())

        const [first] = reloaded.getText('quill').toDelta()
        expect(first).toEqual({ insert: 'prefix ' })
    })

    it('removes formatting via applyDelta null attributes (yjs#474 is fixed upstream)', () => {
        // The replacement_node_modules/y-quill patch existed because 13.4 applyDelta
        // ignored null attributes; the patch was retired on the strength of this behavior.
        const doc = loadFixture('formatBoundaries')
        const text = doc.getText('quill')
        text.applyDelta([{ retain: text.length, attributes: { bold: null, strike: null } }])
        const delta = text.toDelta()
        const formatted = delta.filter(op => op.attributes && (op.attributes.bold || op.attributes.strike))
        expect(formatted).toEqual([])
    })

    it('does not inherit attributes on plain applyDelta inserts (the "bleed" gotcha)', () => {
        const doc = loadFixture('formatBoundaries')
        const text = doc.getText('quill')
        text.applyDelta([{ retain: 2 }, { insert: ' plain ' }])
        const inherited = text
            .toDelta()
            .filter(op => typeof op.insert === 'string' && op.insert.includes('plain') && op.attributes)
        expect(inherited).toEqual([])
    })

    it('merges an embed-object mutation through encodeStateAsUpdate (TemplatesHelper contract)', () => {
        // functions/Templates/TemplatesHelper.js mutates toDelta() embeds in place and
        // relies on re-encoding to persist the rewrite; toDelta must keep returning
        // embed objects by reference.
        const doc = loadFixture('embeds')
        const text = doc.getText('quill')
        const mentionOp = text.toDelta().find(op => op.insert && op.insert.mention)
        mentionOp.insert.mention.userId = 'rewritten-user'

        const reloaded = new Y.Doc()
        Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc))
        const rewritten = reloaded
            .getText('quill')
            .toDelta()
            .find(op => op.insert && op.insert.mention)
        expect(rewritten.insert.mention.userId).toBe('rewritten-user')
    })
})
