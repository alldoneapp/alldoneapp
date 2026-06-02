import React, { useEffect, useRef, useState } from 'react'
import { View, Animated } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { useDispatch, useSelector } from 'react-redux'
import { setQuotedText, setActiveChatMessageId } from '../../../../redux/actions'
import { colors } from '../../../styles/global'
import SwipeAreasContainer from '../../../TaskListView/SwipeAreasContainer'

import MessageItemContent from './MessageItemContent'
import MessageItemHeader from './MessageItemHeader'
import useGetUserPresentationData from '../../../ContactsView/Utils/useGetUserPresentationData'
import { getTimestampInMilliseconds } from '../../Utils/ChatHelper'

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
    const editOpenTimeoutRef = useRef(null)
    const creatorData = useGetUserPresentationData(message.creatorId)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const activeChatMessageId = useSelector(state => state.activeChatMessageId)

    const enableEditMode = () => {
        const hasDismissibleRef = !!dismissibleRef.current
        const modalVisibleBefore = hasDismissibleRef ? dismissibleRef.current.modalIsVisible() : null

        console.log('[ChatEditDebug] enableEditMode called', {
            messageId: message.id,
            blockOpen,
            userIsAnonymous,
            showFloatPopup,
            activeChatMessageId,
            hasDismissibleRef,
            modalVisibleBefore,
        })

        if (!blockOpen && dismissibleRef.current) {
            dispatch(setActiveChatMessageId(message.id))
            if (editOpenTimeoutRef.current) clearTimeout(editOpenTimeoutRef.current)
            editOpenTimeoutRef.current = setTimeout(() => {
                dismissibleRef.current?.openModal(true)
            })

            setTimeout(() => {
                console.log('[ChatEditDebug] enableEditMode after openModal', {
                    messageId: message.id,
                    modalVisibleAfter: dismissibleRef.current?.modalIsVisible?.(),
                })
            })
        } else {
            console.log('[ChatEditDebug] enableEditMode blocked', {
                messageId: message.id,
                blockOpen,
                hasDismissibleRef,
            })
        }
    }

    useEffect(() => {
        return () => {
            if (editOpenTimeoutRef.current) clearTimeout(editOpenTimeoutRef.current)
        }
    }, [])

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

    // Treat isLoading as false if the message hasn't been updated in over 5 minutes
    // to prevent a permanently stuck spinner from stale Firestore data.
    const LOADING_TIMEOUT_MS = 5 * 60 * 1000
    let effectiveIsLoading = message.isLoading
    if (effectiveIsLoading) {
        const messageTime = getTimestampInMilliseconds(message.lastChangeDate)
        if (messageTime && Date.now() - messageTime > LOADING_TIMEOUT_MS) {
            effectiveIsLoading = false
        }
    }

    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125],
        extrapolate: 'clamp',
    })

    return (
        <View style={{ paddingVertical: 8, marginLeft: 14 }}>
            <SwipeAreasContainer pointerEvents="none" style={{ paddingBottom: 16 }} leftText="Quote" />
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
                        onEditPress={enableEditMode}
                        editDisabled={userIsAnonymous}
                    />
                    <MessageItemContent
                        chat={chat}
                        projectId={projectId}
                        commentText={message.commentText}
                        chatTitle={chatTitle}
                        members={members}
                        messageId={message.id}
                        creatorId={message.creatorId}
                        dismissibleRef={dismissibleRef}
                        creatorData={creatorData}
                        objectType={objectType}
                        setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                        isLoading={effectiveIsLoading}
                    />
                </Animated.View>
            </Swipeable>
        </View>
    )
}
