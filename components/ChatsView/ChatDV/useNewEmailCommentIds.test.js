/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useNewEmailCommentIds from './useNewEmailCommentIds'

function Probe({ threadKey, chatNotifications }) {
    const ids = useNewEmailCommentIds(threadKey, chatNotifications)
    return <Text>{[...ids].join(',')}</Text>
}

describe('useNewEmailCommentIds', () => {
    test('keeps new IDs visible after read acknowledgement and resets for another thread', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <Probe threadKey="project-1:chat-1" chatNotifications={{ unfollowedCommentIds: ['email-1'] }} />
            )
        })
        expect(tree.root.findByType(Text).props.children).toBe('email-1')

        act(() => {
            tree.update(<Probe threadKey="project-1:chat-1" chatNotifications={undefined} />)
        })
        expect(tree.root.findByType(Text).props.children).toBe('email-1')

        act(() => {
            tree.update(<Probe threadKey="project-1:chat-2" chatNotifications={undefined} />)
        })
        expect(tree.root.findByType(Text).props.children).toBe('')
    })

    test('captures notifications that arrive after the view mounts', () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe threadKey="project-1:chat-1" chatNotifications={undefined} />)
        })

        act(() => {
            tree.update(
                <Probe
                    threadKey="project-1:chat-1"
                    chatNotifications={{ unfollowedCommentIds: ['email-1', 'email-2'] }}
                />
            )
        })

        expect(tree.root.findByType(Text).props.children).toBe('email-1,email-2')
    })
})
