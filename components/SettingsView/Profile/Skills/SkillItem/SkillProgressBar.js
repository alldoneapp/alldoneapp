import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'

export default function SkillProgressBar({ skill, higherSkill }) {
    const { points } = skill
    const progressPercent = (points / higherSkill) * 66
    const highLightColor = skill.hasStar !== '#FFFFFF' ? skill.hasStar : colors.Grey300

    return <View style={[localStyles.progress, { width: `${progressPercent}%`, backgroundColor: highLightColor }]} />
}

const localStyles = StyleSheet.create({
    progress: {
        position: 'absolute',
        left: -1,
        top: -1,
        minHeight: 40,
        backgroundColor: colors.Grey300,
        zIndex: -2,
        borderRadius: 4,
        borderWidth: 0,
    },
})
