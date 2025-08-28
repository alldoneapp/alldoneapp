import React from 'react'
import { View } from 'react-native'
import { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function Arrow({ direction }) {
    return direction === 'left' ? (
        <View style={{ marginLeft: -10 }}>
            <Icon name="chevron-left" size={24} color={colors.Text03} />
        </View>
    ) : (
        <View style={{ marginRight: -10 }}>
            <Icon name="chevron-right" size={24} color={colors.Text03} />
        </View>
    )
}
