import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import {
    resetFloatPopup,
    setNavigationRoute,
    setSkillInDv,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
    navigateToAllProjectsTasks,
} from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import SharedHelper from '../../utils/SharedHelper'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import NavigationService from '../../utils/NavigationService'
import DvContainer from './DvContainer'
import store from '../../redux/store'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import usePrivateProject from '../../hooks/usePrivateProject'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'

export default function SkillDetailedView({ navigation }) {
    const dispatch = useDispatch()
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const skill = useSelector(state => state.skillInDv)

    const projectId = navigation.getParam('projectId', undefined)
    const skillId = navigation.getParam('skillId', undefined)
    const initialSkill = navigation.getParam('skill', undefined)

    usePrivateProject(projectId)

    const redirectOut = showAccessDeniedModal => {
        if (isAnonymous) {
            SharedHelper.redirectToPrivateResource()
        } else {
            const { selectedTypeOfProject } = store.getState()

            NavigationService.navigate('Root')
            if (selectedTypeOfProject === PROJECT_TYPE_SHARED) {
                dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            } else {
                const actionsToDispatch = [resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()]
                if (showAccessDeniedModal) actionsToDispatch.push(setShowAccessDeniedPopup(true))
                dispatch(actionsToDispatch)
            }
        }
    }

    const checkIfIsPrivateSkill = isPublicFor => {
        const isPrivateForUser =
            !isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (isAnonymous || !isPublicFor.includes(loggedUserId))
        return isPrivateForUser
    }

    const updateSkill = skillUpdated => {
        if (skillUpdated) {
            const isPrivateForUser = checkIfIsPrivateSkill(skillUpdated.isPublicFor)
            isPrivateForUser ? redirectOut(true) : dispatch(setSkillInDv(skillUpdated))
        } else {
            redirectOut(false)
        }
    }

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        dispatch(setNavigationRoute('SkillDetailedView'))
    }, [])

    useEffect(() => {
        if (initialSkill) {
            const isPrivateForUser = checkIfIsPrivateSkill(initialSkill.isPublicFor)
            if (isPrivateForUser) redirectOut(true)
        }
    }, [])

    useEffect(() => {
        dispatch(setSkillInDv(initialSkill))
        const watcherKey = v4()
        Backend.watchSkill(projectId, skillId, watcherKey, updateSkill)
        return () => {
            dispatch(setSkillInDv(null))
            Backend.unwatch(watcherKey)
        }
    }, [projectId, skillId])

    const showLoggedUserSideMenu =
        (!isAnonymous && !smallScreenNavigation) || (isAnonymous && smallScreenNavigation && showWebSideBar.visible)
    const showAnonymousUserSideMenu = !smallScreenNavigation && isAnonymous

    return (
        <View style={localStyles.container}>
            {showLoggedUserSideMenu && <CustomSideMenu navigation={navigation} isWeb />}
            {skill && <DvContainer projectId={projectId} />}
            {showAnonymousUserSideMenu && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
})
