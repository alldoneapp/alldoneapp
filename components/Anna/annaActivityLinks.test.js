import { describeActivityLink, splitActivityPreview, truncateActivityText } from './annaActivityLinks'
import { annaActivityPreview, formatAnnaActivityText } from './annaActivityText'
import { setLanguage } from '../../i18n/TranslationService'

describe('activity links (AT-2906)', () => {
    it.each([
        ['https://github.com/kwkrass/alldone_team/actions/runs/123', 'GitHub · Actions'],
        ['https://github.com/kwkrass/alldone_team/pull/88', 'GitHub · PR #88'],
        ['https://gitlab.com/alldonegmbh/alldone/-/pipelines/3002632748', 'GitLab · Pipeline #3002632748'],
        ['https://gitlab.com/alldonegmbh/alldone/-/merge_requests/745', 'GitLab · MR !745'],
        ['https://my.alldone.app/projects/p1/tasks/t1/chat', 'Alldone'],
        ['https://www.example.com/a/b', 'example.com'],
        // Saved before AT-2906: cut by the old 240-character limit.
        ['https://github.com/kwkrass/alldone_team/actions/r…', 'GitHub · Actions'],
    ])('describes %s', (url, label) => {
        expect(describeActivityLink(url).label).toBe(label)
    })

    it('keeps sentence punctuation outside the chip', () => {
        expect(splitActivityPreview('Pipeline: https://gitlab.com/a/b/-/pipelines/7. Done')).toEqual([
            { type: 'text', text: 'Pipeline: ' },
            { type: 'link', url: 'https://gitlab.com/a/b/-/pipelines/7', label: 'GitLab · Pipeline #7' },
            { type: 'text', text: '. Done' },
        ])
    })

    it('never cuts a URL in half', () => {
        const text = `${'x'.repeat(20)} https://github.com/kwkrass/alldone_team/actions/runs/123`
        expect(truncateActivityText(text, 40)).toBe(`${'x'.repeat(20)}…`)
        expect(annaActivityPreview(text, 40)).toBe(`${'x'.repeat(20)}…`)
        expect(truncateActivityText('short', 40)).toBe('short')
    })
})

describe('legacy entry texts (AT-2906)', () => {
    beforeEach(() => setLanguage('de'))
    afterEach(() => setLanguage('en'))

    it('reads old assistant/MCP task feeds in the user language', () => {
        expect(formatAnnaActivityText('marked as complete')).toBe('Aufgabe als erledigt markiert')
        expect(formatAnnaActivityText('marked as incomplete')).toBe('Aufgabe auf „Offen“ gesetzt')
        expect(formatAnnaActivityText('updated task (name, priority)')).toBe('Aufgabe aktualisiert')
        expect(formatAnnaActivityText('updated note')).toBe('Notiz aktualisiert')
        expect(formatAnnaActivityText('Selbst geschriebener Text')).toBe('Selbst geschriebener Text')
    })
})
