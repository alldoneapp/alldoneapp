import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import { translate } from '../../../i18n/TranslationService'
import styles, { colors } from '../../styles/global'

export default function OptionText({ active, badge, text }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <Text
            style={[
                localStyles.optionText,
                badge == null && localStyles.optionTextWithoutBadge,
                active && localStyles.activeIndex,
                smallScreenNavigation && { paddingLeft: 4 },
            ]}
        >
            {translate(text)}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    optionText: {
        ...styles.body2,
        color: colors.Text03,
        justifyContent: 'center',
        alignItems: 'center',
        height: 22,
        paddingLeft: 12,
        paddingRight: 4,
        fontWeight: '400',
    },
    optionTextWithoutBadge: {
        paddingRight: 12,
    },
    activeIndex: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
})
