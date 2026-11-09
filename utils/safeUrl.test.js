/**
 * Security audit 2026-11 (NV-03, NV-05, NV-36): member-written links must never reach the browser
 * as script URLs.
 */
import fs from 'fs'
import path from 'path'
import { getSafeFrameUrl, getSafeNavigationUrl, installWindowOpenGuard, isSafeNavigationUrl } from './safeUrl'

const repoRoot = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8')

describe('isSafeNavigationUrl', () => {
    test.each([
        'https://calendar.google.com/event?eid=1',
        'http://example.com',
        'mailto:someone@example.com',
        'tel:+49123',
        'blob:https://my.alldone.app/1234',
        '/projects/p1/tasks/open',
    ])('allows %s', url => {
        expect(isSafeNavigationUrl(url)).toBe(true)
    })

    test.each([
        'javascript:alert(document.domain)',
        'JavaScript:alert(1)',
        ' javascript:alert(1)',
        '\tjava\nscript:alert(1)',
        'javascript://example.com/%0aalert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        '',
        null,
        undefined,
    ])('refuses %p', url => {
        expect(isSafeNavigationUrl(url)).toBe(false)
        expect(getSafeNavigationUrl(url)).toBe('')
    })

    test('frames take https only', () => {
        expect(getSafeFrameUrl('https://alldone.team/x')).toBe('https://alldone.team/x')
        for (const url of ['http://example.com', 'blob:https://x/1', 'javascript:alert(1)', 'data:text/html,x']) {
            expect(getSafeFrameUrl(url)).toBe('')
        }
    })
})

describe('the window.open guard', () => {
    test('blocks script URLs and passes everything else through', () => {
        const original = jest.fn(() => 'window')
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        window.open = original
        installWindowOpenGuard()

        expect(window.open('javascript:alert(1)', '_blank')).toBeNull()
        expect(window.open(' JAVASCRIPT:alert(1)')).toBeNull()
        expect(window.open('data:text/html,x')).toBeNull()
        expect(original).not.toHaveBeenCalled()

        expect(window.open('https://example.com', '_blank')).toBe('window')
        expect(window.open('', '_blank')).toBe('window')
        expect(original).toHaveBeenCalledTimes(2)
        warn.mockRestore()
    })

    test('the app installs it at start', () => {
        expect(read('AppNavigator.js')).toMatch(/installWindowOpenGuard\(\)/)
    })

    test('the known member-written sinks check the URL themselves too', () => {
        expect(read('components/Tags/CalendarTag.js')).toMatch(/getSafeNavigationUrl\(url\)/)
        expect(read('components/ContactDetailedView/ContactProperties/ContactProperties.js')).toMatch(
            /getSafeNavigationUrl\(user\.linkedInUrl\)/
        )
        expect(read('components/Tags/FileDownloadableTag.js')).toMatch(/getSafeNavigationUrl\(uri\)/)
        expect(read('components/MyDayView/AssistantLine/AssistantOptions/helper.js')).toMatch(
            /getSafeNavigationUrl\(task\.link\)/
        )
        expect(read('components/UIComponents/FloatModals/IframeModal/EmbeddedAppFrame.js')).toMatch(
            /src=\{getSafeFrameUrl\(finalUrl\)/
        )
        expect(read('components/Feeds/FeedsModals/ListCommentsComponents/AttachmentBox.js')).toMatch(
            /href=\{getSafeNavigationUrl\(uri\)/
        )
    })
})
