import React, { useRef, useState } from 'react'
import { View, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useDispatch, useSelector } from 'react-redux'
import { setQuotedText } from '../../../../redux/actions'
import { colors } from '../../../styles/global'
import SwipeAreasContainer from '../../../TaskListView/SwipeAreasContainer'

import MessageItemContent from './MessageItemContent'
import MessageItemHeader from './MessageItemHeader'
import useGetUserPresentationData from '../../../ContactsView/Utils/useGetUserPresentationData'

export default function MessageItem({
    chat,
    projectId,
    message,
    serverTime,
    chatTitle,
    members,
    objectType,
    highlight,
    setAmountOfNewCommentsToHighligth,
}) {
    const dispatch = useDispatch()
    const userIsAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const itemSwipe = useRef(null)
    const dismissibleRef = useRef(null)
    const creatorData = useGetUserPresentationData(message.creatorId)

    const onQuote = () => {
        const { displayName } = creatorData
        dispatch(
            setQuotedText({
                text: message.commentText,
                userName: displayName,
            })
        )
        dismissibleRef.current.closeModal()
    }

    const renderLeftSwipe = (progress, dragX) => {
        if (panColor != dragX) setPanColor(dragX)
        return <View style={{ width: 150 }} />
    }

    const onLeftSwipe = () => {
        itemSwipe.current.close()
        onQuote()
    }

    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    return (
        <View style={{ paddingVertical: 8, marginLeft: 14 }}>
            <SwipeAreasContainer style={{ paddingBottom: 16 }} leftText="Quote" />
            <Swipeable
                ref={itemSwipe}
                leftThreshold={80}
                enabled={!userIsAnonymous && dismissibleRef.current && !dismissibleRef.current.modalIsVisible()}
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
                <Animated.View
                    style={{ backgroundColor: backColor, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 4 }}
                >
                    <MessageItemHeader
                        projectId={projectId}
                        message={message}
                        serverTime={serverTime}
                        creatorData={creatorData}
                        highlight={highlight}
                    />
                    <MessageItemContent
                        chat={chat}
                        projectId={projectId}
                        commentText={message.commentText}
                        chatTitle={chatTitle}
                        members={members}
                        messageId={message.id}
                        creatorId={message.creatorId}
                        blockOpen={blockOpen}
                        dismissibleRef={dismissibleRef}
                        creatorData={creatorData}
                        objectType={objectType}
                        setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                        isLoading={message.isLoading}
                    />
                </Animated.View>
            </Swipeable>
        </View>
    )
}
