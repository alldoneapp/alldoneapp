import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet, View } from 'react-native'

import AiStepCheckBox from './AiStepCheckBox'
import Spinner from '../../../../UIComponents/Spinner'
import { colors } from '../../../../styles/global'

describe('AiStepCheckBox', () => {
    test('renders an outlined purple circle with a filled purple play triangle when ready', () => {
        const tree = renderer.create(<AiStepCheckBox running={false} />)
        const views = tree.root.findAllByType(View)
        const circleStyle = StyleSheet.flatten(views[0].props.style)
        const triangleStyle = StyleSheet.flatten(views[1].props.style)

        expect(circleStyle).toMatchObject({
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: colors.UtilityViolet300,
        })
        expect(triangleStyle).toMatchObject({
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: colors.UtilityViolet300,
            borderLeftWidth: 8,
        })
        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
    })

    test('preserves the spinner while the AI step is running', () => {
        const tree = renderer.create(<AiStepCheckBox running />)

        expect(tree.root.findByType(Spinner).props).toMatchObject({
            containerSize: 24,
            spinnerSize: 16,
            containerColor: colors.UtilityViolet100,
            spinnerColor: colors.UtilityViolet300,
        })
    })
})
