import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import DoneButton from './DoneButton'
import AssignComment from './AssignComment'
import CancelButton from './CancelButton'

export default function MainButtonsArea({
    hasName,
    isSuggestedTask,
    dismissEditMode,
    setTask,
    adding,
    accessGranted,
    width,
}) {
    const smallScreen = useSelector(state => state.smallScreen)

    const addingSuggestedTask = isSuggestedTask && adding
    const hideCancelButton =
        smallScreen || (addingSuggestedTask && width < 833) || (!isSuggestedTask && !adding && width < 839)
    const showAssignCommentButton = addingSuggestedTask && width > 394

    const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }

    return (
        <View style={localStyles.container}>
            {!hideCancelButton && <CancelButton buttonItemStyle={buttonItemStyle} dismissEditMode={dismissEditMode} />}
            {showAssignCommentButton && (
                <AssignComment
                    setTask={setTask}
                    buttonItemStyle={buttonItemStyle}
                    disabled={!hasName || !accessGranted}
                />
            )}
            <DoneButton
                adding={adding}
                setTask={setTask}
                hasName={hasName}
                isSuggestedTask={isSuggestedTask}
                accessGranted={accessGranted}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
