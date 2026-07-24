import React, { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import ProjectLine from './ProjectLine'
import UserLine from './UserLine'
import NotificationBubble from './NotificationBubble'
import ProjectEmailLabelChips from '../EmailLine/ProjectEmailLabelChips'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'

export default function ProjectAndUserData({ projectIndex, projectId, badge, userInHeader, showEmailLabels = false }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const {
        showFollowedBubble,
        showUnfollowedBubble,
        totalFollowed,
        totalUnfollowed,
    } = useShowNewCommentsBubbleInBoard(projectId)

    const [titleWidth, setTitleWidth] = useState('auto')
    const subContainer = useRef()

    const calcTitleWidth = ({ nativeEvent }) => {
        setTitleWidth(nativeEvent.layout.width)
    }

    return (
        <View ref={subContainer} onLayout={calcTitleWidth} style={localStyles.subContainer}>
            <View style={[localStyles.titleSubContainer, { maxWidth: titleWidth }]}>
                <ProjectLine badge={badge} projectIndex={projectIndex} user={userInHeader} />

                {(userInHeader.displayName !== undefined || userInHeader.photoURL !== undefined) && (
                    <View style={localStyles.dotSeparator} />
                )}

                <UserLine projectIndex={projectIndex} projectId={projectId} user={userInHeader} />
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
                <View style={localStyles.compass}>
                    <Icon name="compass" color="white" size={19} />
                </View>
            </View>
            {showEmailLabels && <ProjectEmailLabelChips projectId={projectId} />}
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
    titleSubContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        // Allow the project/user name block to shrink (and truncate) so an inline email-label
        // chip placed after it stays visible on the header row instead of overflowing.
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
