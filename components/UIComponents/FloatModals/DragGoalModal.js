import React, { useEffect } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import styles from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function DragGoalModal({ closeDragMode }) {
    useEffect(() => {
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Escape') {
            closeDragMode()
        }
    }

    return (
        <View style={localStyles.container}>
            <Icon name={'multi-selection-selected'} size={24} color={'#ffffff'} />
            <Text style={localStyles.info}>{translate('Sorting mode active description')}</Text>
            <TouchableOpacity style={localStyles.buttonX} onPress={closeDragMode}>
                <Icon name="x" color={colors.Text03} size={24} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Secondary400,
        paddingLeft: 8,
        paddingRight: 8,
        height: 56,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${24}px rgba(0,0,0,0.04), ${0}px ${8}px ${16}px rgba(0,0,0,0.04)`,
            },
        }),
        position: 'absolute',
        bottom: 24,
        alignItems: 'center',
        marginLeft: 'auto',
        marginRight: 'auto',
        left: 0,
        right: 0,
        borderWidth: 1,
        borderColor: '#C6CDD2',
        width: 'fit-content',
    },
    info: {
        ...styles.body2,
        color: '#ffffff',
        marginLeft: 8,
    },
    buttonX: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        alignContent: 'center',
        marginLeft: 8,
    },
})
