import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import BackButton from './BackButton'
import TagList from './TagList'
import TitlePresentation from './TitlePresentation'
import TitleEdition from './TitleEdition'
import LastEdition from './LastEdition'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import DVHamburgButton from '../../UIControls/DVHamburgButton'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_GOAL_CHAT, DV_TAB_GOAL_NOTE } from '../../../utils/TabNavigationConstants'
import styles, { colors } from '../../styles/global'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import DvBotButton from '../../UIControls/DvBotButton'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'

export default function Header({ goal, projectId, navigation, accessGranted, isFullscreen, setFullscreen }) {
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const [editionMode, setEditionMode] = useState(false)
    const [showEllipsis, setShowEllipsis] = useState(false)
    const maxHeight = (selectedTab === DV_TAB_GOAL_CHAT || selectedTab === DV_TAB_GOAL_NOTE) && !editionMode ? 64 : 800

    const { completionMilestoneDate } = goal

    const openTitleEdition = () => {
        setEditionMode(true)
    }

    const closeTitleEdition = () => {
        setEditionMode(false)
    }

    useEffect(() => {
        if (showGlobalSearchPopup && editionMode) {
            closeTitleEdition()
        }
    }, [showGlobalSearchPopup])

    const onTitleLayoutChange = ({ nativeEvent }) => {
        const { layout } = nativeEvent

        if (layout.height > maxHeight && !showEllipsis) {
            setShowEllipsis(true)
        } else if (layout.height <= maxHeight && showEllipsis) {
            setShowEllipsis(false)
        }
    }

    const loggedUserIsGoalOwner = goal.ownerId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={[localStyles.container, isFullscreen && { paddingBottom: 8 }]}>
            <View style={localStyles.upperHeader}>
                {isMiddleScreen && accessGranted && <BackButton projectId={projectId} goal={goal} />}

                {mobile && loggedUser.isAnonymous && (
                    <View style={localStyles.backButtonMobile}>
                        <DVHamburgButton navigation={navigation} />
                    </View>
                )}

                <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
                    {editionMode ? (
                        <TitleEdition goal={goal} projectId={projectId} closeTitleEdition={closeTitleEdition} />
                    ) : (
                        <View onLayout={onTitleLayoutChange}>
                            <TitlePresentation
                                projectId={projectId}
                                openTitleEdition={openTitleEdition}
                                goal={goal}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                            />
                        </View>
                    )}
                    {showEllipsis && !editionMode && (
                        <Text style={[localStyles.ellipsis, { right: mobile ? 32 : 80 }]}>...</Text>
                    )}
                </View>
            </View>
            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    <TagList
                        completionMilestoneDate={completionMilestoneDate}
                        goal={goal}
                        projectId={projectId}
                        accessGranted={accessGranted}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                    />
                    <LastEdition projectId={projectId} goal={goal} />
                    <CopyLinkButton style={{ marginRight: 8 }} />
                    <DvBotButton navItem={DV_TAB_GOAL_CHAT} projectId={projectId} assistantId={goal.assistantId} />
                    <OpenInNewWindowButton />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_GOAL_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={goal.id}
                        assistantId={goal.assistantId}
                        projectId={projectId}
                        objectType={'goals'}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingBottom: 24,
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    titleContainer: {
        marginRight: 'auto',
        flex: 1,
        maxHeight: 800,
        overflowY: 'hidden',
    },
    bottomHeader: {
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButtonMobile: {
        left: -16,
    },
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
})
