import React, { useEffect } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import Line from '../GoalMilestoneModal/Line'
import LevelAndPoints from './LevelAndPoints'
import ButtonsArea from './ButtonsArea'
import Header from './Header'

export default function LevelUpModal({ setShowLevelUpModal }) {
    const closeModal = () => {
        setShowLevelUpModal(false)
    }

    const onKeyDown = event => {
        if (event.key === 'Escape') closeModal()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <Header />
                <LevelAndPoints />
                <Text style={localStyles.text}>{translate('Earned skill points description')}</Text>
                <Line style={localStyles.line} />
                <ButtonsArea closeModal={closeModal} />
                <CloseButton close={closeModal} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        ...Platform.select({ web: { position: 'fixed' } }),
    },
    container: {
        maxHeight: '90%',
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        padding: 16,
    },
    line: {
        marginVertical: 16,
    },
    text: {
        ...styles.body1,
        color: colors.Grey400,
    },
})
