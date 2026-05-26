import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { HAPPINESS_EMOJIS, HAPPINESS_SCALE } from '../../utils/ProjectHappinessHelper'

export default function HappinessRatingPicker({ value, onChange, compact, light }) {
    return (
        <View style={[localStyles.container, compact && localStyles.containerCompact]}>
            {HAPPINESS_SCALE.map(rating => {
                const selected = value === rating
                return (
                    <TouchableOpacity
                        key={rating}
                        style={[
                            localStyles.button,
                            compact && localStyles.buttonCompact,
                            light && localStyles.buttonLight,
                            selected && localStyles.buttonSelected,
                        ]}
                        onPress={() => onChange(rating)}
                    >
                        <Text style={localStyles.emoji}>{HAPPINESS_EMOJIS[rating]}</Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    containerCompact: {
        justifyContent: 'flex-end',
    },
    button: {
        width: 40,
        height: 40,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
        borderWidth: 1,
        borderColor: colors.Grey200,
        backgroundColor: '#FFFFFF',
    },
    buttonCompact: {
        width: 36,
        height: 36,
    },
    buttonLight: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderColor: 'rgba(255,255,255,0.2)',
    },
    buttonSelected: {
        borderColor: colors.Primary300,
        backgroundColor: colors.Primary100,
    },
    emoji: {
        ...styles.title6,
        lineHeight: 24,
    },
})
