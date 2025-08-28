import React, { useRef, useState } from 'react'
import { Animated, Image, StyleSheet, Text, View } from 'react-native'
import FeedInteractionBar from '../InteractionBar/FeedInteractionBar'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SocialText from '../../UIControls/SocialText/SocialText'
import ObjectHeaderParser from '../TextParser/ObjectHeaderParser'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { goToFeedSource } from '../Utils/HelperFunctions'
import NavigationService from '../../../utils/NavigationService'
import SharedHelper from '../../../utils/SharedHelper'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useSelector } from 'react-redux'

const NoteObjectHeader = ({ projectId, feed }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const [showInteractionBar, setShowInteractionBar] = useState(false)
    const itemSwipe = useRef()

    const { name, type, noteId, userId } = feed

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
        goToFeedSource(NavigationService, projectId, 'note', feed.noteId)
    }

    const tagList = ({ inInteractionBar, bgColor }) => {
        const assignee = TasksHelper.getUserInProject(projectId, userId)

        return (
            <Animated.View
                style={[
                    localStyles.tagsContainer,
                    { backgroundColor: bgColor },
                    inInteractionBar ? { marginRight: 8 } : null,
                ]}
            >
                {assignee && (
                    <View style={localStyles.noteAssignee}>
                        <Image style={localStyles.noteAssigneeImage} source={assignee?.photoURL} />
                    </View>
                )}
            </Animated.View>
        )
    }

    const feedModel = ({ inInteractionBar, bgColor }) => {
        return (
            <View
                style={[
                    localStyles.header,
                    inInteractionBar ? localStyles.expanded : null,
                    inInteractionBar && isMiddleScreen ? { paddingLeft: 7 } : null,
                ]}
            >
                <View style={{ flexGrow: 1, flex: 1 }}>
                    <View style={{ flexDirection: 'row' }}>
                        <Icon name="file-text" color={colors.Text03} size={24} />

                        {inInteractionBar ? (
                            <ObjectHeaderParser text={name} projectId={projectId} />
                        ) : (
                            <View style={localStyles.descriptionContainer}>
                                <SocialText
                                    style={[styles.body1, { display: 'flex' }]}
                                    numberOfLines={1}
                                    showEllipsis={true}
                                    bgColor={bgColor}
                                    projectId={projectId}
                                    normalStyle={{ whiteSpace: 'normal' }}
                                    onPress={e => {
                                        if (!inInteractionBar && !activeModalInFeed && !blockOpen) {
                                            openInteractionBar()
                                        }
                                    }}
                                >
                                    {name}
                                </SocialText>
                            </View>
                        )}
                    </View>
                </View>

                {tagList({ inInteractionBar, bgColor })}
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
                enabled={accessGranted}
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
                    {feedModel({ backColor: backColor })}
                </Animated.View>
            </Swipeable>
        </View>
    )
}

export default NoteObjectHeader

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
    descriptionContainer: {
        flexGrow: 1,
        paddingLeft: 12,
        flex: 1,
    },
    noteAssignee: {
        flexDirection: 'row',
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    noteAssigneeImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
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
