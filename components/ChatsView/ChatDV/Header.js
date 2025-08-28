import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import BackButton from './BackButton'
import TagList from './TagList'
import BotLine from './BotLine/BotLine'
import ChatTitle from './ChatTitle'
import ChatTitleEdition from './ChatTitleEdition'
import { useSelector } from 'react-redux'
import { DV_TAB_CHAT_BOARD, DV_TAB_CHAT_NOTE } from '../../../utils/TabNavigationConstants'
import styles, { colors } from '../../styles/global'
import SharedHelper from '../../../utils/SharedHelper'

const Header = ({ projectId, chat, isFullscreen, setFullscreen }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const [editionMode, setEditionMode] = useState(false)
    const [title, setTitle] = useState(chat.title)
    const [showEllipsis, setShowEllipsis] = useState(false)
    const maxHeight = (selectedTab === DV_TAB_CHAT_BOARD || selectedTab === DV_TAB_CHAT_NOTE) && !editionMode ? 64 : 350

    const onTitleLayoutChange = ({ nativeEvent }) => {
        const { layout } = nativeEvent

        if (layout.height > maxHeight && !showEllipsis) {
            setShowEllipsis(true)
        } else if (layout.height <= maxHeight && showEllipsis) {
            setShowEllipsis(false)
        }
    }

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
                            <View onLayout={onTitleLayoutChange}>
                                <ChatTitle
                                    projectId={projectId}
                                    title={title}
                                    openTitleEdition={() => setEditionMode(true)}
                                    disabled={!accessGranted}
                                />
                            </View>
                        )}
                        {showEllipsis && !editionMode && (
                            <Text style={[localStyles.ellipsis, { right: mobile ? 32 : 80 }]}>...</Text>
                        )}
                    </View>
                )}
            </View>
            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    <TagList projectId={projectId} chat={chat} />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_CHAT_BOARD && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={chat.id}
                        assistantId={chat.assistantId}
                        projectId={projectId}
                        objectType={'chats'}
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

export default Header
