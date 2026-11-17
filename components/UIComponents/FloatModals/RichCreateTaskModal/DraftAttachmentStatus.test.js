import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))
jest.mock('../../Spinner', () => 'Spinner')
jest.mock('../../../Icon', () => 'Icon')

import DraftAttachmentStatus, { DRAFT_ATTACHMENT_STATUS, getDraftAttachmentStatus } from './DraftAttachmentStatus'

const LOCAL_FILE = 'O2TI2SATTA blob:local-1###photo.png O2TI2SATTA'

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<DraftAttachmentStatus {...props} />)
    })
    return tree
}

const textOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .join('')

describe('getDraftAttachmentStatus (AT-3070)', () => {
    it('is none without local files and not uploading', () => {
        expect(getDraftAttachmentStatus({ uploadingDraft: false, uploadFailed: false, description: 'plain' })).toBe(
            DRAFT_ATTACHMENT_STATUS.NONE
        )
        expect(getDraftAttachmentStatus({ uploadingDraft: false, uploadFailed: true, description: undefined })).toBe(
            DRAFT_ATTACHMENT_STATUS.NONE
        )
    })

    it('is attached for local files that were not uploaded yet', () => {
        expect(getDraftAttachmentStatus({ uploadingDraft: false, uploadFailed: false, description: LOCAL_FILE })).toBe(
            DRAFT_ATTACHMENT_STATUS.ATTACHED
        )
    })

    it('is uploading while the upload runs, even right after a failure', () => {
        expect(getDraftAttachmentStatus({ uploadingDraft: true, uploadFailed: true, description: LOCAL_FILE })).toBe(
            DRAFT_ATTACHMENT_STATUS.UPLOADING
        )
    })

    it('is failed, never attached, when local files are left after a failed upload', () => {
        expect(getDraftAttachmentStatus({ uploadingDraft: false, uploadFailed: true, description: LOCAL_FILE })).toBe(
            DRAFT_ATTACHMENT_STATUS.FAILED
        )
    })
})

describe('DraftAttachmentStatus (AT-3070)', () => {
    it('renders nothing without draft files', () => {
        const tree = render({ uploadingDraft: false, uploadFailed: false, description: '' })
        expect(tree.toJSON()).toBeNull()
    })

    it('shows an animated spinner and a busy live region while uploading', () => {
        const tree = render({ uploadingDraft: true, uploadFailed: false, description: LOCAL_FILE })
        const row = tree.root.findByProps({ testID: 'draft-attachment-status-uploading' })
        expect(row.props.accessibilityState).toEqual({ busy: true })
        expect(row.props.accessibilityLiveRegion).toBe('polite')
        expect(tree.root.findAllByType('Spinner')).toHaveLength(1)
        expect(textOf(tree)).toBe('Adding files to description…')
    })

    it('shows a static icon, no spinner, for attached files', () => {
        const tree = render({ uploadingDraft: false, uploadFailed: false, description: LOCAL_FILE })
        expect(tree.root.findAllByType('Spinner')).toHaveLength(0)
        expect(tree.root.findByType('Icon').props.name).toBe('paperclip')
        expect(textOf(tree)).toBe('Files added to description')
    })

    it('shows the failure, no spinner, after a failed upload', () => {
        const tree = render({ uploadingDraft: false, uploadFailed: true, description: LOCAL_FILE })
        expect(tree.root.findAllByType('Spinner')).toHaveLength(0)
        expect(tree.root.findByType('Icon').props.name).toBe('alert-circle')
        expect(tree.root.findByProps({ testID: 'draft-attachment-status-failed' }).props.accessibilityRole).toBe(
            'alert'
        )
        expect(textOf(tree)).toBe('Task attachment upload failed')
    })
})
