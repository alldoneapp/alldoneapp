import React from 'react'
import { Animated } from 'react-native'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../../../UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../../../../Tags/GmailTag', () => 'GmailTag')
jest.mock('../../../../../utils/Gmail/gmailTaskUtils', () => ({ isGmailLabelFollowUpTask: () => false }))

import TitleContainer from './TitleContainer'

/**
 * AT-2404. The title is where the strike-through is mounted, and the two things worth pinning here
 * are the ones a unit test of the strike itself cannot see: that an ordinary row does not pay for
 * the overlay at all, and that the DOM id handed to it is the one the title actually renders under
 * — get that wrong and the strike silently falls back to spanning the whole column, which looks
 * almost right and is very easy to miss.
 */

const task = { id: 'task-1', name: 'Write the launch brief', extendedName: '', isSubtask: false, linkBack: [] }

const renderTitle = completionStrike => {
    let tree
    act(() => {
        tree = renderer.create(
            <TitleContainer
                task={task}
                projectId={'project-1'}
                isObservedTask={false}
                setTaskTitleIsMultiline={jest.fn()}
                completionStrike={completionStrike}
            />
        )
    })
    return tree
}

const strikes = tree => tree.root.findAllByProps({ testID: 'task-completion-strike' })

describe('TitleContainer completion strike', () => {
    it('mounts no overlay for a task that is not being completed', () => {
        // Every row in every list renders this component, so the overlay must not exist until there
        // is actually something to cross out.
        expect(strikes(renderTitle(null))).toHaveLength(0)
    })

    it('crosses the title out while the row is completing', () => {
        expect(strikes(renderTitle({ progress: new Animated.Value(0), animated: true }))).not.toHaveLength(0)
    })

    it('measures against the same DOM id the title renders under', () => {
        const tree = renderTitle({ progress: new Animated.Value(0), animated: true })

        const socialTextId = tree.root.findByType('SocialText').props.elementId
        const strikeId = tree.root.findByProps({ testID: 'task-completion-strike' }).parent.props.elementId

        // Derived from the rendered title rather than written out, so renaming the id cannot leave
        // the strike measuring an element that no longer exists.
        expect(strikeId).toBe(socialTextId)
        expect(strikeId).toBe('social_text_project-1_task-1_false')
    })
})
