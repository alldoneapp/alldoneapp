import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import TitlePresentation from './TitlePresentation'
import TitleEdition from './TitleEdition'
import BackButton from './BackButton'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import DVHamburgButton from '../../UIControls/DVHamburgButton'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_ASSISTANT_CHAT, DV_TAB_ASSISTANT_NOTE } from '../../../utils/TabNavigationConstants'
import DvBotButton from '../../UIControls/DvBotButton'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'

export default function Header({
    projectId,
    projectDetailedId,
    assistant,
    navigation,
    isGlobalAsisstant,
    isFullscreen,
    setFullscreen,
}) {
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const [editionMode, setEditionMode] = useState(false)

    const maxHeight =
        (selectedTab === DV_TAB_ASSISTANT_NOTE || selectedTab === DV_TAB_ASSISTANT_CHAT) && !editionMode ? 64 : 800

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

    return (
        <View style={[localStyles.container, isFullscreen && { paddingBottom: 8 }]}>
            <View style={localStyles.upperHeader}>
                {isMiddleScreen && <BackButton assistant={assistant} />}

                {mobile && loggedUser.isAnonymous && (
                    <View style={localStyles.backButtonMobile}>
                        <DVHamburgButton navigation={navigation} />
                    </View>
                )}

                <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
                    {editionMode ? (
                        <TitleEdition
                            projectId={projectId}
                            assistant={assistant}
                            closeTitleEdition={closeTitleEdition}
                        />
                    ) : (
                        <TitlePresentation
                            openTitleEdition={openTitleEdition}
                            assistant={assistant}
                            disabled={isGlobalAsisstant || loggedUser.isAnonymous}
                            hideLastEdited={isFullscreen}
                            maxHeight={maxHeight}
                        />
                    )}
                </View>
            </View>
            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    <View style={{ flex: 1 }} />
                    <CopyLinkButton style={{ marginRight: 8 }} />
                    <DvBotButton
                        navItem={DV_TAB_ASSISTANT_CHAT}
                        projectId={projectDetailedId}
                        assistantId={assistant.uid}
                    />
                    <OpenInNewWindowButton />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_ASSISTANT_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={assistant.uid}
                        assistantId={assistant.uid}
                        projectId={projectDetailedId}
                        objectType={'assistants'}
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
})
