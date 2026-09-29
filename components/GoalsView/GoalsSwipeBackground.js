import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function GoalsSwipeBackground({ needToShowReminderButton }) {
    return (
        <View style={localStyles.swipeContainer}>
            <View style={localStyles.leftSwipeArea}>
                <Icon name="circle-details" size={18} color={colors.UtilityGreen200} />
                <View style={{ marginLeft: 4 }}>
                    <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>{translate('Tasks')}</Text>
                </View>
            </View>

            <View style={localStyles.rightSwipeArea}>
                <View style={localStyles.rightSwipeAreaContainer}>
                    <Icon name="calendar" size={18} color={colors.UtilityYellow200} />
                    <View style={{ marginLeft: 4 }}>
                        <Text style={[styles.subtitle2, { color: colors.UtilityYellow200 }]}>
                            {translate(needToShowReminderButton ? 'Reminder' : 'Milestone')}
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
    rightSwipeAreaContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    rightSwipeArea: {
        flexDirection: 'row',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 4,
        paddingRight: 12,
    },
})
