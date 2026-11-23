import React, { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import ProjectLine from './ProjectLine'
import UserLine from './UserLine'
import NotificationBubble from './NotificationBubble'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'

export default function ProjectAndUserData({
    projectIndex,
    projectId,
    badge,
    userInHeader,
    headerTextColor,
    centered = false,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { showFollowedBubble, showUnfollowedBubble, totalFollowed, totalUnfollowed } =
        useShowNewCommentsBubbleInBoard(projectId)

    const [titleWidth, setTitleWidth] = useState('auto')
    const subContainer = useRef()

    const calcTitleWidth = ({ nativeEvent }) => {
        setTitleWidth(nativeEvent.layout.width)
    }

    return (
        <View
            ref={subContainer}
            onLayout={calcTitleWidth}
            style={[localStyles.subContainer, centered && localStyles.subContainerCentered]}
            testID="project-and-user-data"
        >
            <View style={[localStyles.titleSubContainer, { maxWidth: titleWidth }]}>
                <ProjectLine
                    badge={badge}
                    projectIndex={projectIndex}
                    user={userInHeader}
                    textColor={headerTextColor}
                />

                {(userInHeader.displayName !== undefined || userInHeader.photoURL !== undefined) && (
                    <View style={[localStyles.dotSeparator, headerTextColor && { backgroundColor: headerTextColor }]} />
                )}

                <UserLine
                    projectIndex={projectIndex}
                    projectId={projectId}
                    user={userInHeader}
                    textColor={headerTextColor}
                />
                {showFollowedBubble && (
                    <NotificationBubble
                        amount={totalFollowed}
                        isFollowedNotification={true}
                        containerStyle={smallScreenNavigation ? { marginLeft: 4 } : undefined}
                        projectId={projectId}
                    />
                )}
                {showUnfollowedBubble && (
                    <NotificationBubble
                        amount={totalUnfollowed}
                        containerStyle={smallScreenNavigation && totalFollowed <= 0 ? { marginLeft: 4 } : undefined}
                        projectId={projectId}
                    />
                )}
                {/* An invisible legacy placeholder; it would push a centred title off-centre (AT-3132). */}
                {!centered && (
                    <View style={localStyles.compass}>
                        <Icon name="compass" color="white" size={19} />
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    subContainer: {
        maxHeight: 24,
        height: 24,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    // AT-3132: the selected project's top line (see centeredHeaderTitle.js).
    subContainerCentered: {
        justifyContent: 'center',
        minWidth: 0,
    },
    titleSubContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        // Allow the project/user name block to shrink (and truncate) instead of overflowing the
        // header row.
        flexShrink: 1,
        minWidth: 0,
    },
    compass: {
        backgroundColor: 'green',
        borderRadius: 100,
        opacity: 0,
    },
    dotSeparator: {
        width: 4,
        height: 4,
        borderRadius: 16,
        backgroundColor: colors.Text02,
        marginHorizontal: 6,
    },
})
