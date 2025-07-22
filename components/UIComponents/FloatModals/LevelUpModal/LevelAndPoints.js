import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { resetUserNewEarnedSkillPoints } from '../../../../utils/backends/Users/usersFirestore'

export default function LevelAndPoints() {
    const level = useSelector(state => state.loggedUser.level)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const newEarnedSkillPoints = useSelector(state => state.loggedUser.newEarnedSkillPoints)
    const [earnedSkillPoints, setEarnedSkillPoints] = useState(0)

    useEffect(() => {
        if (newEarnedSkillPoints > 0) {
            resetUserNewEarnedSkillPoints(loggedUserId)
            setEarnedSkillPoints(earnedSkillPoints => earnedSkillPoints + newEarnedSkillPoints)
        }
    }, [newEarnedSkillPoints])

    return (
        <View style={localStyles.levelContainger}>
            <Text style={localStyles.text}>{translate('You have reached')}</Text>
            <Text style={localStyles.levelText}>{translate('Level', { level })}</Text>
            <Text style={localStyles.text}>
                {translate('you gained skillpoints', { skillPoints: earnedSkillPoints })}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    levelContainger: {
        alignItems: 'center',
        marginVertical: 20,
    },
    text: {
        ...styles.body1,
        color: colors.Grey400,
    },
    levelText: {
        ...styles.title3,
        color: colors.Grey400,
        marginVertical: 32,
    },
})
