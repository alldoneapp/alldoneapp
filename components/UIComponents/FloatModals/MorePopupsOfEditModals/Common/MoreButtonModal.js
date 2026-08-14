import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import styles, { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import useWindowSize from '../../../../../utils/useWindowSize'
import { translate } from '../../../../../i18n/TranslationService'

export default function MoreButtonModal({
    children,
    formType,
    projectId,
    object,
    objectType,
    closePopover,
    delayClosePopover,
}) {
    const [width, height] = useWindowSize()

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = e => {
        if (e.key === 'Escape') {
            e?.preventDefault()
            e?.stopPropagation()

            delayClosePopover()
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 20 }}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('More options')}</Text>
                </View>

                {children}

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={delayClosePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
