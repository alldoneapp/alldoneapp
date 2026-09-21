import { isLegacyEmailUrlFragment, shouldRenderAsLegacyEmailText } from './legacyEmailUrlFragment'

describe('legacy generated-note email URL fragments', () => {
    it.each([
        ['karsten.wysk', ' Karsten Wysk <', '@gmail.com>'],
        ['jan.gohrke', ' Jan Gohrke <', '@rmc-'],
        ['consult.de', '@rmc-', '>'],
        ['daniel.sommerer', ' Daniel Sommerer <', '@rmc-'],
    ])('renders %s as text when it completes an email address', (url, previousText, nextText) => {
        expect(shouldRenderAsLegacyEmailText(url, previousText, nextText)).toBe(true)
    })

    it.each([
        ['https://calendar.google.com/calendar/event?eid=abc', 'Calendar: ', ''],
        ['meet.google.com/abc-defg-hij', 'Google Meet ', ''],
        ['consult.de', 'Visit ', ' for details'],
        ['google.com', '', ''],
    ])('keeps the real URL %s rendered as a link', (url, previousText, nextText) => {
        expect(shouldRenderAsLegacyEmailText(url, previousText, nextText)).toBe(false)
    })

    it('detects the legacy fragment from the URL blot DOM siblings used by the renderer', () => {
        const parent = document.createElement('p')
        const embed = document.createElement('span')
        parent.append(document.createTextNode(' Karsten Wysk <'), embed, document.createTextNode('@gmail.com>'))

        expect(isLegacyEmailUrlFragment(embed, 'karsten.wysk')).toBe(true)
    })
})
