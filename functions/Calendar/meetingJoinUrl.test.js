const { extractMeetingJoinUrl, __private__ } = require('./meetingJoinUrl')
const { decodeHtmlEntities, providerForUrl, trimUrlPunctuation } = __private__

describe('extractMeetingJoinUrl — source precedence', () => {
    test('hangoutLink wins over everything else', () => {
        const result = extractMeetingJoinUrl({
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
            conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://acme.zoom.us/j/999' }] },
            location: 'https://acme.webex.com/meet/x',
        })
        expect(result).toEqual({
            joinUrl: 'https://meet.google.com/abc-defg-hij',
            joinProvider: 'google_meet',
            source: 'hangoutLink',
        })
    })

    test('a Google conferencing add-on is read from entryPoints', () => {
        const result = extractMeetingJoinUrl({
            conferenceData: {
                entryPoints: [
                    { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
                    { entryPointType: 'video', uri: 'https://acme.zoom.us/j/8675309?pwd=abc' },
                ],
            },
        })
        expect(result.joinUrl).toBe('https://acme.zoom.us/j/8675309?pwd=abc')
        expect(result.joinProvider).toBe('zoom')
    })

    test('a dial-in-only event yields no join link', () => {
        expect(
            extractMeetingJoinUrl({
                conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1-555-0100' }] },
            })
        ).toBeNull()
    })

    test('Microsoft onlineMeeting.joinUrl is picked up', () => {
        const result = extractMeetingJoinUrl({
            conferenceData: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0' },
        })
        expect(result.joinProvider).toBe('teams')
        expect(result.source).toBe('conferenceData.joinUrl')
    })

    test('location is used before description', () => {
        const result = extractMeetingJoinUrl({
            location: 'Room 4 — https://whereby.com/alldone',
            description: 'https://acme.zoom.us/j/1',
        })
        expect(result).toEqual({
            joinUrl: 'https://whereby.com/alldone',
            joinProvider: 'whereby',
            source: 'location',
        })
    })

    test('a real Google HTML description is decoded and scanned', () => {
        const result = extractMeetingJoinUrl({
            description:
                'Agenda: <a href="https://docs.google.com/document/d/1">notes</a><br>' +
                'Join Zoom Meeting<br>https://alldone.zoom.us/j/123456?pwd=aa&amp;from=addon',
        })
        expect(result).toEqual({
            joinUrl: 'https://alldone.zoom.us/j/123456?pwd=aa&from=addon',
            joinProvider: 'zoom',
            source: 'description',
        })
    })

    test('a non-conferencing link never becomes the join target', () => {
        expect(
            extractMeetingJoinUrl({
                location: 'Alldone HQ, Berlin',
                description: 'Prep doc: https://docs.google.com/document/d/1 and https://github.com/acme/repo',
            })
        ).toBeNull()
    })

    test('an event with nothing at all yields null', () => {
        expect(extractMeetingJoinUrl({})).toBeNull()
        expect(extractMeetingJoinUrl()).toBeNull()
    })
})

describe('providerForUrl — host matching', () => {
    test('vanity and regional subdomains resolve to their provider', () => {
        expect(providerForUrl('https://acme.zoom.us/j/1')).toBe('zoom')
        expect(providerForUrl('https://alldone.webex.com/meet/karsten')).toBe('webex')
        expect(providerForUrl('https://meet.google.com/abc')).toBe('google_meet')
    })

    test('lookalike hosts are rejected', () => {
        expect(providerForUrl('https://notzoom.us/j/1')).toBe('')
        expect(providerForUrl('https://zoom.us.evil.com/j/1')).toBe('')
        expect(providerForUrl('not a url')).toBe('')
    })
})

describe('trimUrlPunctuation', () => {
    test('strips trailing prose punctuation', () => {
        expect(trimUrlPunctuation('https://meet.google.com/abc.')).toBe('https://meet.google.com/abc')
        expect(trimUrlPunctuation('https://meet.google.com/abc,')).toBe('https://meet.google.com/abc')
    })

    test('strips an unbalanced closing bracket but keeps balanced ones', () => {
        expect(trimUrlPunctuation('https://meet.google.com/abc)')).toBe('https://meet.google.com/abc')
        expect(trimUrlPunctuation('https://teams.microsoft.com/l/x(y)')).toBe('https://teams.microsoft.com/l/x(y)')
    })
})

describe('decodeHtmlEntities', () => {
    test('decodes &amp; last so double-encoded entities survive', () => {
        expect(decodeHtmlEntities('a&amp;b')).toBe('a&b')
        expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
    })
})
