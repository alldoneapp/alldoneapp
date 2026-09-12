import React from 'react'
import { StyleSheet, View } from 'react-native'

import WordsList from './WordsList'
import LeftTagsAndIcons from './LeftTagsAndIcons'
import { getTextStartMarkerId } from './textRangeMarkers'

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
    leadingStatusElement,
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
                leadingStatusElement={leadingStatusElement}
                leftCustomElement={leftCustomElement}
                activeCalendarStyle={activeCalendarStyle}
                task={task}
            />
            {/* Start of the title TEXT. Empty, hidden and zero-size, exactly like the end marker
                below — the two exist so that a DOM range can be drawn around the words WITHOUT
                the leading chips above, which are plain siblings here because `LeftTagsAndIcons`
                renders a fragment. See `textRangeMarkers.js`. */}
            {elementId && <View style={{ visibility: 'hidden' }} nativeID={getTextStartMarkerId(elementId)} />}
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
            {/* End of the title text, and an end-of-text position probe in its own right:
                `TasksHelper.showWrappedTaskEllipsis` reads this element's `bottom`/`left` to decide
                whether the title overflowed, so it must stay LAST and stay zero-size. */}
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
