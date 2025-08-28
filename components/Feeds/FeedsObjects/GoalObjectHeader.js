import React, { useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import FeedInteractionBar from '../InteractionBar/FeedInteractionBar'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SocialText from '../../UIControls/SocialText/SocialText'
import ObjectHeaderParser from '../TextParser/ObjectHeaderParser'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { getTagCommentsPrivacyData, goToFeedSource } from '../Utils/HelperFunctions'
import NavigationService from '../../../utils/NavigationService'
import SharedHelper from '../../../utils/SharedHelper'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useSelector } from 'react-redux'
import useGetMessages from '../../../hooks/Chats/useGetMessages'
import GoalCommentsWrapper from '../../GoalsView/GoalCommentsWrapper'

const GoalObjectHeader = ({ projectId, feed, isLocked }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const [showInteractionBar, setShowInteractionBar] = useState(false)
    const itemSwipe = useRef()

    const { name, type, goalId } = feed
    const messages = useGetMessages(false, false, projectId, goalId, 'goals')

    const openInteractionBar = () => {
        if (!blockOpen) {
            setShowInteractionBar(true)
        }
    }

    const renderLeftSwipe = (progress, dragX) => {
        setPanColor(dragX)
        return <View style={{ width: 150 }} />
    }

    const onLeftSwipe = () => {
        itemSwipe?.current?.close()
        goToFeedSource(NavigationService, projectId, 'goal', feed.goalId)
    }

    const tagList = ({ inInteractionBar, bgColor }) => {
        const showVerticalEllipsis = TasksHelper.showWrappedTaskEllipsis(
            `social_tags_${projectId}_${goalId}`,
            `social_text_${projectId}_${goalId}`
        )
        const commentsData = getTagCommentsPrivacyData(messages)

        return (
            <Animated.View
                style={[
                    localStyles.tagsContainer,
                    { backgroundColor: bgColor },
                    inInteractionBar ? { marginRight: 8 } : null,
                ]}
                nativeID={`social_tags_${projectId}_${goalId}`}
            >
                {showVerticalEllipsis && !inInteractionBar && <Text style={localStyles.verticalEllipsis}>...</Text>}

                {!inInteractionBar && !!commentsData && (
                    <GoalCommentsWrapper commentsData={commentsData} projectId={projectId} goal={{ id: goalId }} />
                )}
            </Animated.View>
        )
    }

    const feedModel = ({ inInteractionBar, subscribeClickObserver, unsubscribeClickObserver, bgColor }) => {
        return (
            <View
                style={[
                    localStyles.header,
                    inInteractionBar ? localStyles.expanded : null,
                    inInteractionBar && isMiddleScreen ? { paddingLeft: 7 } : null,
                ]}
                pointerEvents={isLocked ? 'none' : 'auto'}
            >
                <View style={{ flexGrow: 1, flex: 1 }}>
                    <View style={{ flexDirection: 'row' }}>
                        <Icon
                            name="target"
                            color={colors.Text03}
                            size={24}
                            style={{ top: inInteractionBar ? -2 : 2 }}
                        />

                        {inInteractionBar ? (
                            <ObjectHeaderParser text={name ? name : ''} projectId={projectId} />
                        ) : (
                            <View style={localStyles.descriptionContainer}>
                                <SocialText
                                    elementId={`social_text_${projectId}_${goalId}`}
                                    style={[styles.body1, localStyles.descriptionText]}
                                    numberOfLines={3}
                                    wrapText={true}
                                    bgColor={bgColor}
                                    projectId={projectId}
                                    onPress={e => {
                                        if (!inInteractionBar && !activeModalInFeed && !blockOpen) {
                                            openInteractionBar()
                                        }
                                    }}
                                >
                                    {name ? name : ''}
                                </SocialText>
                            </View>
                        )}
                    </View>
                </View>
                {tagList({
                    inInteractionBar,
                    subscribeClickObserver,
                    unsubscribeClickObserver,
                    bgColor,
                })}
            </View>
        )
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const outputColors = [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125]
    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: outputColors,
        extrapolate: 'clamp',
    })

    return showInteractionBar ? (
        <FeedInteractionBar
            FeedModel={props => feedModel(props)}
            setShowInteractionBar={setShowInteractionBar}
            feedObjectType={type}
            projectId={projectId}
            feed={feed}
            isHeaderObject={true}
        />
    ) : (
        <View>
            <View style={localStyles.swipeContainer}>
                <View style={localStyles.leftSwipeArea}>
                    <Icon name="circle-details" size={18} color={colors.UtilityGreen200} />
                    <View style={{ marginLeft: 4 }}>
                        <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>Details</Text>
                    </View>
                </View>

                <View style={localStyles.rightSwipeArea}>
                    <View style={localStyles.rightSwipeAreaContainer} />
                </View>
            </View>

            <Swipeable
                ref={itemSwipe}
                rightThreshold={80}
                leftThreshold={80}
                enabled={accessGranted && !isLocked}
                renderLeftActions={renderLeftSwipe}
                onSwipeableLeftWillOpen={onLeftSwipe}
                overshootLeft={false}
                overshootRight={false}
                friction={2}
                containerStyle={{ overflow: 'visible' }}
                failOffsetY={[-5, 5]}
                onSwipeableWillClose={() => {
                    setBlockOpen(true)
                }}
                onSwipeableClose={() => {
                    setBlockOpen(false)
                }}
            >
                <Animated.View style={[localStyles.headerSwipe, { backgroundColor: backColor }]}>
                    {feedModel({ bgColor: backColor })}
                </Animated.View>
            </Swipeable>
        </View>
    )
}

export default GoalObjectHeader

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
    },
    expanded: {
        paddingVertical: 8,
        paddingLeft: 16,
        width: '100%',
        minHeight: 60,
    },
    tagsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        position: 'absolute',
        right: 0,
        bottom: 4,
        paddingLeft: 8,
        backgroundColor: '#ffffff',
    },
    descriptionContainer: {
        flexGrow: 1,
        paddingLeft: 12,
        flex: 1,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    verticalEllipsis: {
        ...styles.body1,
        alignSelf: 'baseline',
        color: '#000000',
    },
    headerSwipe: {
        paddingVertical: 8,
        paddingLeft: 8,
        paddingRight: 8,
        marginLeft: -8,
        marginRight: -8,
        borderRadius: 4,
    },
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
    rightSwipeAreaContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    rightSwipeArea: {
        flexDirection: 'row',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 4,
        paddingRight: 12,
    },
})
