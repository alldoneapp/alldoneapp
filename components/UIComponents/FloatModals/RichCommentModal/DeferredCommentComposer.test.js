import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import DeferredCommentComposer from './DeferredCommentComposer'

const createManualScheduler = () => {
    let callback
    const schedule = nextCallback => {
        callback = nextCallback
        return () => {
            callback = null
        }
    }
    schedule.flush = () => callback?.()
    return schedule
}

describe('DeferredCommentComposer', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('lets the desktop popup shell paint before mounting the composer', () => {
        const schedule = createManualScheduler()
        let tree
        act(() => {
            tree = renderer.create(
                <DeferredCommentComposer defer resetKey="project:tasks:task" schedule={schedule}>
                    <Text>Comment editor</Text>
                </DeferredCommentComposer>
            )
        })

        expect(tree.root.findAllByProps({ testID: 'comment-composer-placeholder' })).toHaveLength(1)
        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        act(() => schedule.flush())

        expect(tree.root.findAllByProps({ testID: 'comment-composer-placeholder' })).toHaveLength(0)
        expect(tree.root.findByType(Text).props.children).toBe('Comment editor')
    })

    it('mounts immediately on mobile to preserve gesture-scoped keyboard focus', () => {
        const schedule = createManualScheduler()
        let tree
        act(() => {
            tree = renderer.create(
                <DeferredCommentComposer defer={false} resetKey="project:tasks:task" schedule={schedule}>
                    <Text>Comment editor</Text>
                </DeferredCommentComposer>
            )
        })

        expect(tree.root.findAllByProps({ testID: 'comment-composer-placeholder' })).toHaveLength(0)
        expect(tree.root.findByType(Text).props.children).toBe('Comment editor')
    })
})
