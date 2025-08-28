import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../styles/global'
import Button from '../UIControls/Button'
import { setShowProjectDontExistInInvitationModal } from '../../redux/actions'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'

export default function ProjectDontExistInInvitationModal() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const closeModal = () => {
        dispatch(setShowProjectDontExistInInvitationModal(false))
    }

    const sidebarOpenStyle = smallScreenNavigation ? null : { marginLeft: 300 }

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.popup, applyPopoverWidth(), sidebarOpenStyle]}>
                <View style={localStyles.header}>
                    <Text style={localStyles.title}>{translate('Invitation to project')}</Text>
                    <Text style={localStyles.description}>{translate('Looks like this project does not exist')}</Text>
                </View>
                <View style={{ flexDirection: 'row', flex: 0 }}>
                    <Button title={'Ok'} type={'primary'} onPress={closeModal} />
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
    popup: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
    },
    header: {
        marginBottom: 20,
        width: '100%',
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
})
