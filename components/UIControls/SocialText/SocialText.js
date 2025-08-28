import React, { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import ReactDOM from 'react-dom'

import { parseFeedComment } from '../../Feeds/Utils/HelperFunctions'
import Dots from './Dots'
import Content from './Content'
import { convertEstimationToPixels } from '../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import { shouldOnPressInput } from '../../TaskListView/Utils/TasksHelper'

export default function SocialText({
    task,
    children,
    showEllipsis,
    blockOpen,
    elementId,
    onTextLayout,
    style,
    onPress,
    numberOfLines,
    wrapText,
    hasLinkBack,
    linkStyle,
    inTaskDetailedView,
    emailStyle,
    hashtagStyle,
    mentionStyle,
    textStyle,
    normalStyle,
    isSubtask,
    hasStar,
    bgColor,
    projectId,
    inFeedComment,
    milestoneDate,
    milestone,
    isActiveMilestone,
    leftCustomElement,
    activeCalendarStyle,
    tagsExpandedHeight,
    isObservedTask,
    showVerticalEllipsisInByTime,
    dotsStyle,
}) {
    const [visibleEllipsis, setVisibleEllipsis] = useState(false)
    const [textSectionWidth, setTextSectionWidth] = useState(0)
    const [textItemWidth, setTextItemWidth] = useState(0)
    const [wordList, setWordList] = useState([])

    const textSection = useRef(null)

    const calculateTextSectionWidth = () => {
        const textSectionWidth = ReactDOM.findDOMNode(textSection.current).offsetWidth
        setTextSectionWidth(textSectionWidth)

        if (textItemWidth > 0) handleShowEllipsis()
    }

    const onLayoutChange = layout => {
        const textItemWidth = layout.nativeEvent.layout.width
        setTextItemWidth(textItemWidth)

        calculateTextSectionWidth()
    }

    const handleShowEllipsis = () => {
        if (textSectionWidth > textItemWidth && !visibleEllipsis) {
            setVisibleEllipsis(true)
        } else if (textSectionWidth < textItemWidth && visibleEllipsis) {
            setVisibleEllipsis(false)
        }
    }

    useEffect(() => {
        const wordList = parseFeedComment(children, task && task.genericData ? true : false, false)
        setWordList(wordList)
        calculateTextSectionWidth()
    }, [])

    useEffect(() => {
        const wordList = parseFeedComment(children, task && task.genericData ? true : false, false)
        setWordList(wordList)

        if (showEllipsis) calculateTextSectionWidth()
    }, [children])

    const content = (
        <Content
            task={task}
            elementId={elementId}
            onTextLayout={onTextLayout}
            numberOfLines={numberOfLines}
            wrapText={wrapText}
            hasLinkBack={hasLinkBack}
            linkStyle={linkStyle}
            inTaskDetailedView={inTaskDetailedView}
            emailStyle={emailStyle}
            hashtagStyle={hashtagStyle}
            mentionStyle={mentionStyle}
            textStyle={textStyle}
            normalStyle={normalStyle}
            projectId={projectId}
            inFeedCommen={inFeedComment}
            milestoneDate={milestoneDate}
            milestone={milestone}
            isActiveMilestone={isActiveMilestone}
            leftCustomElement={leftCustomElement}
            activeCalendarStyle={activeCalendarStyle}
            textSection={textSection}
            wordList={wordList}
            calculateTextSectionWidth={calculateTextSectionWidth}
        />
    )

    return (
        <Text
            style={[
                style,
                { textAlignVertical: 'center', flexDirection: 'row' },
                activeCalendarStyle &&
                    (task.time || task.completedTime) && {
                        height: convertEstimationToPixels(task) + tagsExpandedHeight,
                        maxHeight: undefined,
                        paddingTop: 40 + tagsExpandedHeight,
                    },
            ]}
            onPress={e => {
                if (onPress && shouldOnPressInput(e, blockOpen)) onPress(e)
            }}
            numberOfLines={activeCalendarStyle ? 1 : numberOfLines}
            onLayout={onLayoutChange}
        >
            {activeCalendarStyle ? (
                <View nativeID={`social_text_container_${projectId}_${task.id}_${isObservedTask}`}>{content}</View>
            ) : (
                content
            )}
            {(showVerticalEllipsisInByTime || (showEllipsis && visibleEllipsis)) && (
                <Dots
                    textStyle={textStyle}
                    normalStyle={dotsStyle || normalStyle}
                    isSubtask={isSubtask}
                    hasStar={hasStar}
                    bgColor={bgColor}
                />
            )}
        </Text>
    )
}
