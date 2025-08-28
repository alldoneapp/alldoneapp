import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import AvatarWrapper from './AvatarWrapper'

export default function AssistantData({ disabled, projectId, assistant }) {
    const { displayName, description } = assistant

    return (
        <View style={localStyles.container}>
            <AvatarWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
            <View style={localStyles.texts}>
                <Text style={[styles.title6, { marginBottom: 4 }]} numberOfLines={1}>
                    {displayName}
                </Text>
                {!!description && (
                    <Text
                        style={[
                            styles.subtitle1,
                            {
                                color: colors.Text02,
                                marginBottom: 4,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {description}
                    </Text>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 51,
        flexDirection: 'row',
        justifyContent: 'center',
        flex: 1,
    },
    texts: {
        flex: 1,
        height: 51,
        justifyContent: 'center',
        marginHorizontal: 8,
    },
})
