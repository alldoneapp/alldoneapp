import React from 'react'
import { StyleSheet } from 'react-native'
import renderer from 'react-test-renderer'

import MainButtons from './MainButtons'

jest.mock('./BackwardButton', () => 'BackwardButton')
jest.mock('./ForwardButton', () => 'ForwardButton')
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ OPEN_STEP: -1 }))

describe('MainButtons layout', () => {
    it('keeps the full workflow modal toolbar spacing by default', () => {
        const tree = renderer.create(<MainButtons currentStep={0} selectedCustomStep={false} onDonePress={jest.fn()} />)
        const container = tree.root.findByProps({ testID: 'workflow-main-buttons' })

        expect(StyleSheet.flatten(container.props.style)).toMatchObject({
            minHeight: 72,
            paddingTop: 16,
            paddingBottom: 16,
        })
    })

    it('lets the row grow so a taller forward button cannot eat its own padding', () => {
        const tree = renderer.create(<MainButtons currentStep={0} selectedCustomStep={false} onDonePress={jest.fn()} />)
        const container = tree.root.findByProps({ testID: 'workflow-main-buttons' })
        const style = StyleSheet.flatten(container.props.style)

        // A fixed height clamped the 52px sub-labelled forward button and swallowed part
        // of the 16px bottom padding that separates it from the bypass link (AT-2354).
        expect(style.height).toBeUndefined()
    })

    it('uses a compact, equally sized button row when embedded in a comment popup', () => {
        const tree = renderer.create(
            <MainButtons compact currentStep={0} selectedCustomStep={false} onDonePress={jest.fn()} />
        )
        const container = tree.root.findByProps({ testID: 'workflow-main-buttons' })
        const backwardButton = tree.root.findByType('BackwardButton')
        const forwardButton = tree.root.findByType('ForwardButton')

        expect(StyleSheet.flatten(container.props.style)).toMatchObject({
            height: 'auto',
            paddingTop: 0,
            paddingBottom: 0,
        })
        expect(StyleSheet.flatten(backwardButton.props.buttonStyle)).toMatchObject({
            flex: 1,
            marginRight: 8,
        })
        expect(StyleSheet.flatten(forwardButton.props.buttonStyle)).toMatchObject({
            flex: 1,
        })
    })

    it('stacks compact actions at full width on narrow screens', () => {
        const tree = renderer.create(
            <MainButtons narrow compact currentStep={0} selectedCustomStep={false} onDonePress={jest.fn()} />
        )
        const container = tree.root.findByProps({ testID: 'workflow-main-buttons' })
        const backwardButton = tree.root.findByType('BackwardButton')
        const forwardButton = tree.root.findByType('ForwardButton')

        expect(StyleSheet.flatten(container.props.style)).toMatchObject({
            flex: 0,
            flexDirection: 'column',
            width: '100%',
        })
        expect(StyleSheet.flatten(backwardButton.props.buttonStyle)).toMatchObject({
            flex: 0,
            marginBottom: 8,
            marginRight: 0,
            width: '100%',
        })
        expect(StyleSheet.flatten(forwardButton.props.buttonStyle)).toMatchObject({
            flex: 0,
            width: '100%',
        })
    })

    it('shows both actions at the first workflow step and names their destinations', () => {
        const tree = renderer.create(
            <MainButtons
                compact
                currentStep={0}
                selectedCustomStep={false}
                onDonePress={jest.fn()}
                backwardStepName="Open"
                forwardStepName="Review"
            />
        )

        expect(tree.root.findByType('BackwardButton').props.targetStepName).toBe('Open')
        expect(tree.root.findByType('ForwardButton').props.targetStepName).toBe('Review')
    })
    it('shows only the forward action while a workflow task is open', () => {
        const tree = renderer.create(
            <MainButtons currentStep={-1} selectedCustomStep={false} onDonePress={jest.fn()} />
        )

        expect(tree.root.findAllByType('BackwardButton')).toHaveLength(0)
        expect(tree.root.findAllByType('ForwardButton')).toHaveLength(1)
    })
})
