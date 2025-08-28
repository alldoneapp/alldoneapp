import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'

export default function BadgeText({ active, badge }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <Text
            style={[
                localStyles.text,
                { color: active ? colors.Primary100 : colors.Text03 },
                smallScreenNavigation && !active ? { marginLeft: 4 } : { paddingRight: 12 },
            ]}
        >
            {badge}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.caption2,
        fontSize: 14,
        lineHeight: 22,
        height: 22,
        minHeight: 22,
        maxHeight: 22,
    },
})
