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
            height: 72,
            paddingTop: 16,
            paddingBottom: 16,
        })
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
})
