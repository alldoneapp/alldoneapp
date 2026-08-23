import React from 'react'
import { Animated } from 'react-native'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../../../UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../../../../Tags/GmailTag', () => 'GmailTag')
jest.mock('../../../../../utils/Gmail/gmailTaskUtils', () => ({ isGmailLabelFollowUpTask: () => false }))

import TitleContainer from './TitleContainer'

/**
 * AT-2404. The title is where the completion progress bar is mounted, and the things worth pinning
 * here are the ones a unit test of the bar itself cannot see: that an ordinary row does not pay for
 * the overlay at all, that the confirmation clock is threaded through with the sweep, and that the
 * DOM id handed to it is the one the title actually renders under — get that wrong and the bar
 * silently falls back to spanning the whole column, which looks almost right and is very easy to
 * miss.
 */

const task = { id: 'task-1', name: 'Write the launch brief', extendedName: '', isSubtask: false, linkBack: [] }

const renderTitle = completionProgress => {
    let tree
    act(() => {
        tree = renderer.create(
            <TitleContainer
                task={task}
                projectId={'project-1'}
                isObservedTask={false}
                setTaskTitleIsMultiline={jest.fn()}
                completionProgress={completionProgress}
            />
        )
    })
    return tree
}

const overlays = tree => tree.root.findAllByProps({ testID: 'task-completion-progress' })
const completing = () => ({ progress: new Animated.Value(0), pulse: new Animated.Value(0), animated: true })

describe('TitleContainer completion progress', () => {
    it('mounts no overlay for a task that is not being completed', () => {
        // Every row in every list renders this component, so the overlay must not exist until there
        // is actually something to sweep.
        expect(overlays(renderTitle(null))).toHaveLength(0)
    })

    it('sweeps the title while the row is completing', () => {
        expect(overlays(renderTitle(completing()))).not.toHaveLength(0)
    })

    it('threads the confirmation clock through with the sweep', () => {
        const completion = completing()
        const tree = renderTitle(completion)

        // Dropping `pulse` here would leave the bar filling to 100% and simply stopping — the
        // failure is invisible in a snapshot, because everything else still animates.
        const progressBar = tree.root.findByProps({ testID: 'task-completion-progress' }).parent
        expect(progressBar.props.pulse).toBe(completion.pulse)
        expect(progressBar.props.progress).toBe(completion.progress)
    })

    it('measures against the same DOM id the title renders under', () => {
        const tree = renderTitle(completing())

        const socialTextId = tree.root.findByType('SocialText').props.elementId
        const overlayId = tree.root.findByProps({ testID: 'task-completion-progress' }).parent.props.elementId

        // Derived from the rendered title rather than written out, so renaming the id cannot leave
        // the sweep measuring an element that no longer exists.
        expect(overlayId).toBe(socialTextId)
        expect(overlayId).toBe('social_text_project-1_task-1_false')
    })
})
