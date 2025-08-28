import React, { useEffect } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { MODAL_MAX_HEIGHT_GAP, applyPopoverWidth } from '../../../../utils/HelperFunctions'
import styles, { colors } from '../../../styles/global'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import NavigationService from '../../../../utils/NavigationService'
import {
    hideFloatPopup,
    navigateToSettings,
    setNotEnabledAssistantWhenLoadComments,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    showFloatPopup,
    storeCurrentUser,
    switchProject,
} from '../../../../redux/actions'
import { DV_TAB_CHAT_BOARD, DV_TAB_ROOT_TASKS, DV_TAB_SETTINGS_PREMIUM } from '../../../../utils/TabNavigationConstants'
import { RUN_OUT_OF_GOLD_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import CloseButton from '../../../FollowUp/CloseButton'
import GoldTag from './GoldTag'
import Button from '../../../UIControls/Button'
import store from '../../../../redux/store'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import { GUIDE_MAIN_CHAT_ID } from '../../../../utils/backends/Projects/guidesFirestore'

export default function RunOutOfGoldForUnlockModal({ closeModal, projectId }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [width, height] = useWindowSize()

    const navigateToPremium = () => {
        NavigationService.navigate('SettingsView')
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
    }

    const navigateToTasks = () => {
        const { loggedUser } = store.getState()

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        let dispatches = [
            switchProject(projectIndex),
            storeCurrentUser(loggedUser),
            setSelectedTypeOfProject(projectType),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
        ]

        dispatch(dispatches)
        TasksHelper.setURLOnChangeToggleOption(0, 'Open')
        NavigationService.navigate('Root')
    }

    const navigateToChats = async () => {
        const { loggedUser } = store.getState()

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)

        let dispatches = [
            switchProject(projectIndex),
            storeCurrentUser(loggedUser),
            setSelectedTypeOfProject(projectType),
            setSelectedNavItem(DV_TAB_CHAT_BOARD),
            dispatch(setNotEnabledAssistantWhenLoadComments(true)),
        ]

        dispatch(dispatches)

        const url = `/projects/${projectId}/chats/${GUIDE_MAIN_CHAT_ID}/chat`
        URLTrigger.processUrl(NavigationService, url)
    }

    useEffect(() => {
        dispatch(showFloatPopup())
        storeModal(RUN_OUT_OF_GOLD_MODAL_ID)
        return () => {
            dispatch(hideFloatPopup())
            removeModal(RUN_OUT_OF_GOLD_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View>
                    <CloseButton style={localStyles.closeButton} close={closeModal} />
                    <View style={localStyles.titleContainer}>
                        <GoldTag />
                        <Text style={localStyles.title}>{translate('Not enough Gold')}</Text>
                    </View>
                    <Text style={[localStyles.description, { marginBottom: 20 }]}>
                        {translate('Not enough Gold description')}
                    </Text>
                    <Text style={[localStyles.description, { marginLeft: 6 }]}>{translate('Earn gold option 1')}</Text>
                    <Text style={[localStyles.description, { marginLeft: 6 }]}>{translate('Earn gold option 2')}</Text>
                    <Text style={[localStyles.description, { marginLeft: 6 }, { marginBottom: 20 }]}>
                        {translate('Earn gold option 3')}
                    </Text>
                </View>
                <View style={localStyles.buttonContainer}>
                    <Button
                        title={translate(smallScreenNavigation ? 'Tasks' : 'Complete tasks')}
                        type={'secondary'}
                        onPress={navigateToTasks}
                    />
                    <Button
                        title={translate('Chat')}
                        type={'secondary'}
                        buttonStyle={localStyles.button}
                        onPress={navigateToChats}
                    />
                    <Button title={translate('Premium')} buttonStyle={localStyles.button} onPress={navigateToPremium} />
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    buttonContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    button: {
        marginLeft: 13,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 31,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        fontWeight: 400,
        color: colors.Grey200,
    },
    closeButton: {
        top: -8,
        right: -8,
    },
})
