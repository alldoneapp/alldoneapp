import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import BadgeText from './BadgeText'
import MobileIcon from './MobileIcon'
import OptionText from './OptionText'

export default function SwitchOption({ i, optionsRefs, onSelectOption, active, option }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { text, icon, badge } = option
    return (
        <TouchableOpacity
            ref={ref => {
                optionsRefs[i] = ref
            }}
            onPress={() => {
                onSelectOption(i, text)
            }}
            style={localStyles.optionIconTouch}
        >
            <View style={[localStyles.optionTextContainer, smallScreenNavigation && !active && localStyles.optionIcon]}>
                {smallScreenNavigation && <MobileIcon icon={icon} active={active} />}
                {(!smallScreenNavigation || active) && <OptionText active={active} badge={badge} text={text} />}
                {badge != null && <BadgeText active={active} badge={badge} />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    optionIconTouch: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    optionIcon: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
    },
    optionTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
