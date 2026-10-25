import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockWindowHeight = 900
jest.mock('../../utils/useWindowSize', () => () => [1200, mockWindowHeight])
jest.mock('../ChatsView/ChatDV/ChatBoard', () => {
    const { Text: MockText } = require('react-native')
    return props => <MockText testID="chat-board">{JSON.stringify(props.chat)}</MockText>
})

import ArtifactChat, { getArtifactChatHeight } from './ArtifactChat'

const ARTIFACT = { id: 'a1', title: 'Sales dashboard', assistantId: 'anna' }

describe('ArtifactChat', () => {
    it("is the artifact's own chat, under the artifacts chat type", () => {
        let tree
        act(() => {
            tree = renderer.create(<ArtifactChat projectId="p1" artifact={ARTIFACT} />)
        })
        const board = tree.root.findByType(require('../ChatsView/ChatDV/ChatBoard'))
        expect(board.props).toMatchObject({
            chat: { id: 'a1', type: 'artifacts' },
            projectId: 'p1',
            objectType: 'artifacts',
            chatTitle: 'Sales dashboard',
            assistantId: 'anna',
            parentObject: ARTIFACT,
        })
        act(() => tree.unmount())
    })

    it('gives the chat a box of its own that never collapses', () => {
        expect(getArtifactChatHeight(900)).toBe(660)
        expect(getArtifactChatHeight(400)).toBe(360)
        expect(getArtifactChatHeight(undefined)).toBe(360)
    })
})
