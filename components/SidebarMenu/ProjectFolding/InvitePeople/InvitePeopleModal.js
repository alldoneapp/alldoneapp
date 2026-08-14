import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import InvitePeopleModalOption from './InvitePeopleModalOption'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_PROJECT_TEAM_MEMBERS, DV_TAB_PROJECT_ASSISTANTS } from '../../../../utils/TabNavigationConstants'

export default function InvitePeopleModal({ closeModal, projectIndex }) {
    const dispatch = useDispatch()

    const navigateToProjectDvTab = tab => {
        closeModal()
        if (tab === DV_TAB_PROJECT_ASSISTANTS) {
            dispatch({ type: 'SET_NAVIGATION_SOURCE', payload: 'ADD_AI_ASSISTANT' })
            setTimeout(() => {
                NavigationService.navigate('ProjectDetailedView', {
                    projectIndex,
                })
                dispatch(setSelectedNavItem(tab))
            }, 0)
        } else {
            NavigationService.navigate('ProjectDetailedView', {
                projectIndex,
            })
            dispatch(setSelectedNavItem(tab))
        }
    }

    return (
        <View style={localStyles.container}>
            <ModalHeader closeModal={closeModal} title={translate('Select option')} />
            <InvitePeopleModalOption
                selectOption={navigateToProjectDvTab}
                tab={DV_TAB_PROJECT_ASSISTANTS}
                icon="cpu"
                text="Add AI Assistant"
            />
            <InvitePeopleModalOption
                selectOption={navigateToProjectDvTab}
                tab={DV_TAB_PROJECT_TEAM_MEMBERS}
                icon="user"
                text="Add human"
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 300,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        padding: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
