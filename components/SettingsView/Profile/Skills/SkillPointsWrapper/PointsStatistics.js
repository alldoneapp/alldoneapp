import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'

export default function PointsStatistics({ points }) {
    const availableSkillPoints = useSelector(state => state.loggedUser.skillPoints)

    return (
        <View>
            <View style={{ flexDirection: 'row' }}>
                <Text style={localStyles.text}>{translate('Available points')} </Text>
                <Text style={localStyles.text}>{availableSkillPoints}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
                <Text style={localStyles.text}>{translate('Current points in the skill')} </Text>
                <Text style={localStyles.text}>{points}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
