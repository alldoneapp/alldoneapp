import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import Avatar from '../Avatar'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { DONE_STEP } from '../TaskListView/Utils/TasksHelper'

export default function WorkflowStepTag({ stepDescription, step, reviewerPhoto, containerStyle }) {
    const isDoneStep = step === DONE_STEP

    return (
        <View style={[localStyles.container, containerStyle]}>
            {isDoneStep ? (
                <Icon style={localStyles.icon} name={'square-checked-gray'} size={16} color={colors.Text03} />
            ) : (
                <Avatar reviewerPhotoURL={reviewerPhoto} externalStyle={localStyles.image} borderSize={0} />
            )}
            <Text style={[localStyles.text, windowTagStyle()]}>{shrinkTagText(stepDescription, 30)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
    },
    icon: {
        marginTop: -1,
        marginLeft: 5.33,
        marginRight: 7.33,
        flexDirection: 'row',
        alignSelf: 'center',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginRight: 8,
    },
    image: {
        marginLeft: 2,
        marginRight: 4,
        backgroundColor: undefined,
    },
})
