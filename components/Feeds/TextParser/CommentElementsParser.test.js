/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import CommentElementsParser from './CommentElementsParser'

jest.mock('../Utils/HelperFunctions', () => ({
    TEXT_ELEMENT: 'text',
    IMAGE_ELEMENT: 'image',
    ATTACHMENT_ELEMENT: 'attachment',
    EMAIL_ELEMENT: 'email',
    HASH_ELEMENT: 'hash',
    KARMA_ELEMENT: 'karma',
    MENTION_ELEMENT: 'mention',
    URL_ELEMENT: 'url',
    VIDEO_ELEMENT: 'video',
    tryToextractPeopleForMention: () => null,
    parseBreakLineFeedComment: text =>
        text.includes('IMG') ? [[{ type: 'image', text: 'IMGfullIMGresizedIMG' }]] : [[{ type: 'text', text }]],
}))
jest.mock('../../../functions/Utils/parseTextUtils', () => ({
    getImageData: () => ({ uri: 'full', resizedUri: 'resized' }),
    getAttachmentData: () => ({}),
    getVideoData: () => ({}),
}))
jest.mock('../../ChatsView/ChatDV/EditorView/codeParserFunctions', () => ({
    divideBoldText: text => [{ text, type: 'text' }],
}))
jest.mock('../../../utils/HelperFunctions', () => ({ getPopoverWidth: () => 432 }))
jest.mock('../CommentsTextInput/autoformat/tags/CustomImage', () => 'CustomImage')
jest.mock('../../Tags/HashTag', () => 'HashTag')
jest.mock('../../Tags/MentionTag', () => 'MentionTag')
jest.mock('../../Tags/EmailTag', () => 'EmailTag')
jest.mock('../../Tags/LinkTag', () => 'LinkTag')
jest.mock('../../Tags/FileDownloadableTag', () => 'FileDownloadableTag')
jest.mock('../../Tags/KarmaTag', () => 'KarmaTag')
jest.mock('../../UIComponents/MediaPlayer', () => 'MediaPlayer')
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({ getDataFromMention: () => ({}) }))
jest.mock('../CommentsTextInput/textInputHelper', () => ({ getKarmaData: () => ({}) }))

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<CommentElementsParser projectId="p1" {...props} />)
    })
    return tree
}
const layout = (tree, width) =>
    act(() => {
        tree.root.findAllByType(View)[0].props.onLayout({ nativeEvent: { layout: { width, height: 100 } } })
    })

describe('CommentElementsParser in a chat (AT-2917)', () => {
    it('sizes images to the measured column, not to the popover width', () => {
        const tree = render({ comment: 'IMG', inChat: true })
        expect(tree.root.findByType('CustomImage').props.maxWidth).toBe(384)

        // A 340px Assistant Mode pane leaves ~226px inside a message bubble.
        layout(tree, 242)
        expect(tree.root.findByType('CustomImage').props.maxWidth).toBe(226)

        // Widening the pane lets the image grow again.
        layout(tree, 500)
        expect(tree.root.findByType('CustomImage').props.maxWidth).toBe(484)
    })

    it('keeps the popover-based width outside a chat', () => {
        const tree = render({ comment: 'IMG' })
        layout(tree, 242)
        expect(tree.root.findByType('CustomImage').props.maxWidth).toBe(384)
    })

    it('lets a word longer than the line shrink and wrap instead of widening the row', () => {
        const tree = render({ comment: 'components/ChatsView/ChatDV/EditorView/MessageItemBody.js', inChat: true })
        const text = tree.root.findAllByType(Text)[0]
        expect(StyleSheet.flatten(text.props.style).minWidth).toBe(0)
    })
})
