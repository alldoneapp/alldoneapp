import React from 'react'
import { StyleSheet, View } from 'react-native'

import OptionButton from './OptionButtons/OptionButton'

export default function QuickActionsMeasurer({ options, onOptionLayout }) {
    return (
        <View
            style={localStyles.container}
            pointerEvents="none"
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
            testID="assistant-quick-actions-measurer"
        >
            {options.map(option => (
                <OptionButton
                    key={option.id}
                    text={option.text}
                    icon={option.icon}
                    // A disabled TouchableOpacity becomes `box-none` in react-native-web. Its
                    // generated child rule restores pointer events on the icon and label, which
                    // lets these transparent absolute copies intercept the visible row. Keep the
                    // measurement copy non-interactive explicitly instead of marking it disabled.
                    pointerEvents="none"
                    focusable={false}
                    accessible={false}
                    testID={`assistant-quick-action-measure-${option.id}`}
                    onLayout={event => onOptionLayout(option.id, event.nativeEvent.layout.width)}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        opacity: 0,
        flexDirection: 'row',
    },
})
