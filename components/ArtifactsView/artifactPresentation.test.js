jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

import {
    canPreviewArtifact,
    formatArtifactSize,
    getArtifactKindIcon,
    getArtifactSourceLabelKey,
    isInlineTextArtifact,
    MAX_INLINE_TEXT_BYTES,
} from './artifactPresentation'

describe('artifact presentation', () => {
    it('formats sizes the way a list row reads them', () => {
        expect(formatArtifactSize(512)).toBe('512 B')
        expect(formatArtifactSize(2048)).toBe('2 KB')
        expect(formatArtifactSize(5.5 * 1024 * 1024)).toBe('5.5 MB')
        expect(formatArtifactSize(undefined)).toBe('0 B')
    })

    it('names where an artifact came from, and treats an unknown source as an upload', () => {
        expect(getArtifactSourceLabelKey('assistant')).toBe('Artifact source assistant')
        expect(getArtifactSourceLabelKey('vm')).toBe('Artifact source vm')
        expect(getArtifactSourceLabelKey(undefined)).toBe('Artifact source upload')
    })

    it('has an icon for every kind and falls back for unknown ones', () => {
        expect(getArtifactKindIcon('web')).toBe('globe')
        expect(getArtifactKindIcon('something-new')).toBe('paperclip')
    })

    it('previews what the app can show and offers the rest as a download', () => {
        expect(canPreviewArtifact({ kind: 'web' })).toBe(true)
        expect(canPreviewArtifact({ kind: 'pdf' })).toBe(true)
        expect(canPreviewArtifact({ kind: 'file' })).toBe(false)
        expect(canPreviewArtifact(null)).toBe(false)
    })

    it('renders small text kinds inline, but not spreadsheets or large files', () => {
        expect(isInlineTextArtifact({ kind: 'markdown', mimeType: 'text/markdown', sizeBytes: 100 })).toBe(true)
        expect(isInlineTextArtifact({ kind: 'data', mimeType: 'text/csv', sizeBytes: MAX_INLINE_TEXT_BYTES + 1 })).toBe(
            false
        )
        expect(
            isInlineTextArtifact({
                kind: 'data',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeBytes: 10,
            })
        ).toBe(false)
        expect(isInlineTextArtifact({ kind: 'web', mimeType: 'text/html', sizeBytes: 10 })).toBe(false)
    })
})

describe('artifact kind groups', () => {
    const {
        filterArtifactsByKindGroup,
        getArtifactKindGroupKey,
        getPresentArtifactKindGroups,
    } = require('./artifactPresentation')

    it('groups kinds the way people look for them, unknown kinds as files', () => {
        expect(getArtifactKindGroupKey('web')).toBe('pages')
        expect(getArtifactKindGroupKey('pdf')).toBe('documents')
        expect(getArtifactKindGroupKey('video')).toBe('media')
        expect(getArtifactKindGroupKey('something-new')).toBe('files')
    })

    it('offers only the groups present, and none when there is only one', () => {
        const artifacts = [{ kind: 'image' }, { kind: 'web' }, { kind: 'audio' }]
        expect(getPresentArtifactKindGroups(artifacts).map(group => group.key)).toEqual(['pages', 'media'])
        expect(getPresentArtifactKindGroups([{ kind: 'web' }, { kind: 'web' }])).toEqual([])
        expect(filterArtifactsByKindGroup(artifacts, 'media')).toEqual([{ kind: 'image' }, { kind: 'audio' }])
        expect(filterArtifactsByKindGroup(artifacts, null)).toBe(artifacts)
    })
})
