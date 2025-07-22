import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { deleteCacheAndRefresh } from '../../../../utils/Observers'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'

export default function EndCopyProjectNotification({}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const name = useSelector(state => state.endCopyProjectPopupData.name)
    const color = useSelector(state => state.endCopyProjectPopupData.color)

    const onKeyDown = e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            reload()
        }
    }

    const reload = () => {
        deleteCacheAndRefresh()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return (
        <View style={localStyles.container}>
            <View style={localStyles.backdrop} />
            <View style={[localStyles.popup, applyPopoverWidth(), smallScreenNavigation && { marginLeft: 300 }]}>
                <View style={localStyles.body}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>
                            {translate('Project duplication finished')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Project duplication description')}
                        </Text>

                        <View style={localStyles.projectName}>
                            <Icon name={'circle-poject_color'} size={24} color={color} />
                            <Text style={[styles.body1, localStyles.title]}>{name}</Text>
                        </View>
                    </View>
                </View>
                <View style={localStyles.buttonContainer}>
                    <Button title={translate('Reload')} type={'primary'} onPress={reload} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10100,
    },
    body: {
        paddingHorizontal: 16,
    },
    popup: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
        maxWidth: 305,
        zIndex: 11000,
    },
    projectName: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
    },
    title: {
        marginLeft: 8,
        color: '#ffffff',
    },
    buttonContainer: {
        width: '100%',
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 16,
        borderTopColor: hexColorToRGBa('#ffffff', 0.2),
        borderTopWidth: 1,
        justifyContent: 'center',
    },
})
