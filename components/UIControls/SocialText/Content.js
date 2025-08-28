import React from 'react'
import { StyleSheet, View } from 'react-native'

import WordsList from './WordsList'
import LeftTagsAndIcons from './LeftTagsAndIcons'

export default function Content({
    task,
    elementId,
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
    projectId,
    inFeedComment,
    milestoneDate,
    milestone,
    isActiveMilestone,
    leftCustomElement,
    activeCalendarStyle,
    textSection,
    wordList,
    onTextLayout,
}) {
    return (
        <View
            ref={textSection}
            style={[
                localStyles.container,
                wrapText ? localStyles.wrapContent : undefined,
                activeCalendarStyle && { maxHeight: 30 },
            ]}
            onLayout={onTextLayout}
        >
            <LeftTagsAndIcons
                projectId={projectId}
                milestoneDate={milestoneDate}
                milestone={milestone}
                isActiveMilestone={isActiveMilestone}
                leftCustomElement={leftCustomElement}
                activeCalendarStyle={activeCalendarStyle}
                task={task}
            />
            <WordsList
                numberOfLines={activeCalendarStyle ? 1 : numberOfLines}
                wrapText={wrapText}
                hasLinkBack={hasLinkBack}
                linkStyle={linkStyle}
                task={task}
                inTaskDetailedView={inTaskDetailedView}
                emailStyle={emailStyle}
                hashtagStyle={hashtagStyle}
                mentionStyle={mentionStyle}
                textStyle={textStyle}
                normalStyle={normalStyle}
                projectId={projectId}
                inFeedComment={inFeedComment}
                wordList={wordList}
            />
            {elementId && <View style={{ visibility: 'hidden' }} nativeID={elementId} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    wrapContent: {
        flex: 1,
        flexWrap: 'wrap',
    },
})
