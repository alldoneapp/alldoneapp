import React from 'react'
import { StyleSheet, View } from 'react-native'

import ProjectLetter from './ProjectLetter'

export default function ColoredCircleSmall({ size, color, containerStyle, isGuide, lineHeight, projectId }) {
    return (
        <View
            style={[
                localStyles.circle,
                {
                    backgroundColor: color,
                    width: size,
                    height: size,
                },
                containerStyle,
            ]}
        >
            {isGuide && <ProjectLetter fontSize={10} lineHeight={lineHeight} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    circle: {
        width: 16,
        height: 16,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
