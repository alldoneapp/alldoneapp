import React from 'react'
import { StyleSheet, View } from 'react-native'

import SwitchOption from './SwitchOption'

export default function Options({ optionsRefs, onSelectOption, currentIndex, options }) {
    return (
        <View style={localStyles.optionsContainer}>
            {options.map((option, i) => {
                return (
                    option && (
                        <SwitchOption
                            key={i}
                            i={i}
                            optionsRefs={optionsRefs}
                            onSelectOption={onSelectOption}
                            active={currentIndex === i}
                            option={option}
                        />
                    )
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    optionsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
