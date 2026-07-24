import React, { useRef, useState } from 'react'
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import FeedInteractionBar from '../InteractionBar/FeedInteractionBar'
import LinealParser from '../TextParser/LinealParser'
import { getTagCommentsPrivacyData, goToFeedSource } from '../Utils/HelperFunctions'
import NavigationService from '../../../utils/NavigationService'
import SharedHelper from '../../../utils/SharedHelper'
import Icon from '../../Icon'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useSelector } from 'react-redux'
import ContactCommentsWrapper from '../../Tags/ContactCommentsWrapper'
import useGetMessages from '../../../hooks/Chats/useGetMessages'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

const UserObjectHeader = ({ feed, projectId }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const [showInteractionBar, setShowInteractionBar] = useState(false)
    const [width, setWidth] = useState(0)
    const itemSwipe = useRef()

    const { type, userId } = feed
    const { shortName, photoURL } = getUserPresentationDataInProject(projectId, userId)

    const messages = useGetMessages(false, false, projectId, userId, 'contacts')

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
        goToFeedSource(NavigationService, projectId, 'user', feed.userId)
    }

    const onLayout = ({ nativeEvent }) => {
        const { width } = nativeEvent.layout
        setWidth(width)
    }

    const feedModel = ({ inInteractionBar }) => {
        const commentsData = getTagCommentsPrivacyData(messages)

        return (
            <View
                onLayout={onLayout}
                style={[
                    localStyles.header,
                    inInteractionBar ? localStyles.expanded : null,
                    inInteractionBar && smallScreenNavigation ? { paddingLeft: 5 } : null,
                ]}
            >
                <Image style={localStyles.avatar} source={{ uri: photoURL }} />

                {inInteractionBar ? (
                    <Text style={localStyles.text}>{shortName}</Text>
                ) : (
                    <LinealParser parentWidth={width} dotsStyle={styles.body1}>
                        <Text style={localStyles.text}>{shortName}</Text>
                    </LinealParser>
                )}

                {!inInteractionBar && !!commentsData && (
                    <View style={localStyles.tagsContainer}>
                        <ContactCommentsWrapper
                            commentsData={commentsData}
                            projectId={projectId}
                            contact={{ uid: userId }}
                            isMember={false}
                        />
                    </View>
                )}
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
                    <TouchableOpacity onPress={openInteractionBar} disabled={activeModalInFeed} accessible={false}>
                        {feedModel({})}
                    </TouchableOpacity>
                </Animated.View>
            </Swipeable>
        </View>
    )
}

export default UserObjectHeader

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
    text: {
        ...styles.body1,
        marginLeft: 12,
        overflow: 'hidden',
        marginRight: 8,
    },
    avatar: {
        borderRadius: 100,
        height: 24,
        width: 24,
        overflow: 'hidden',
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
    tagsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        position: 'absolute',
        right: 0,
        paddingLeft: 8,
    },
})
