import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import BackButton from './BackButton'
import TagList from './TagList'
import BotLine from './BotLine/BotLine'
import ChatTitle from './ChatTitle'
import ChatTitleEdition from './ChatTitleEdition'
import { useSelector } from 'react-redux'
import { DV_TAB_CHAT_BOARD, DV_TAB_CHAT_NOTE } from '../../../utils/TabNavigationConstants'
import SharedHelper from '../../../utils/SharedHelper'

const Header = ({ projectId, chat, assistantId, setAssistantId, isFullscreen, setFullscreen }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const [editionMode, setEditionMode] = useState(false)
    const [title, setTitle] = useState(chat.title)
    const maxHeight = (selectedTab === DV_TAB_CHAT_BOARD || selectedTab === DV_TAB_CHAT_NOTE) && !editionMode ? 64 : 350

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <>
            <View style={[localStyles.upperHeader, { marginLeft: mobile ? -16 : isMiddleScreen ? -56 : -72 }]}>
                {accessGranted && <BackButton isFullscreen={isFullscreen} />}
                {(!isFullscreen || selectedTab === DV_TAB_CHAT_BOARD) && (
                    <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
                        {editionMode ? (
                            <ChatTitleEdition
                                projectId={projectId}
                                title={title}
                                setTitle={setTitle}
                                chat={chat}
                                closeTitleEdition={() => setEditionMode(false)}
                            />
                        ) : (
                            <ChatTitle
                                projectId={projectId}
                                title={title}
                                chat={chat}
                                openTitleEdition={() => setEditionMode(true)}
                                disabled={!accessGranted}
                                hideLastEdited={isFullscreen}
                                maxHeight={maxHeight}
                            />
                        )}
                    </View>
                )}
            </View>
            {!isFullscreen && accessGranted && (
                <View style={localStyles.bottomHeader}>
                    <TagList projectId={projectId} chat={chat} />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_CHAT_BOARD && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={chat.id}
                        assistantId={assistantId}
                        setAssistantId={setAssistantId}
                        projectId={projectId}
                        objectType={'chats'}
                        parentObject={null}
                    />
                </View>
            )}
        </>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        flex: 1,
        marginLeft: 72,
        marginRight: 'auto',
        maxHeight: 350,
        overflowY: 'hidden',
    },
    upperHeader: {
        flexDirection: 'row',
    },
    bottomHeader: {
        paddingTop: 32,
        flexDirection: 'row',
    },
})

export default Header
