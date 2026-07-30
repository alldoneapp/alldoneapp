/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import EditForm from './EditForm'

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const { TextInput } = require('react-native')
    return React.forwardRef((props, ref) => <TextInput ref={ref} testID="comment-input" {...props} />)
})
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { body1: {} },
    colors: { Text03: '#000', Text04: '#fff', Secondary200: '#222' },
}))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    COMMENT_MODAL_THEME: 'COMMENT_MODAL_THEME',
    updateKarmaInInput: jest.fn(),
    checkIfInputHaveKarma: jest.fn(() => false),
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention-modal' }))
jest.mock('../../../../redux/store', () => ({
    getState: () => ({ isQuillTagEditorOpen: false, openModals: {} }),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../ChatsView/ChatDV/EditorView/BotOption/BotButtonWrapper', () => 'BotButtonWrapper')
jest.mock('./SubmitButton', () => 'SubmitButton')

const renderForm = autoFocus =>
    renderer.create(
        <EditForm
            projectId="project-1"
            objectType="goals"
            currentComment=""
            setInitialComment={jest.fn()}
            autoFocus={autoFocus}
        />
    )

describe('RichCommentModal EditForm focus', () => {
    it('passes disabled auto focus to the comment input for unread threads', () => {
        const tree = renderForm(false)

        expect(tree.root.findByProps({ testID: 'comment-input' }).props.autoFocus).toBe(false)
        tree.unmount()
    })

    it('keeps auto focus enabled by default', () => {
        const tree = renderForm(undefined)

        expect(tree.root.findByProps({ testID: 'comment-input' }).props.autoFocus).toBe(true)
        tree.unmount()
    })
})
