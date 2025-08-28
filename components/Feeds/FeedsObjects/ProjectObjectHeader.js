import React, { useState } from 'react'
import { View, StyleSheet, Text } from 'react-native'
import styles from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import FeedInteractionBar from '../InteractionBar/FeedInteractionBar'
import Icon from '../../Icon'
import LinealParser from '../TextParser/LinealParser'

export default function ProjectObjectHeader({ feed, projectId }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { name, color, type } = feed
    const [showInteractionBar, setShowInteractionBar] = useState(false)
    const [width, setWidth] = useState(0)

    const openInteractionBar = () => {
        setShowInteractionBar(true)
    }

    const onLayout = ({ nativeEvent }) => {
        const { width } = nativeEvent.layout
        setWidth(width)
    }

    const FeedModel = ({ inInteractionBar }) => (
        <View
            onLayout={onLayout}
            style={[
                localStyles.header,
                inInteractionBar ? localStyles.expanded : null,
                inInteractionBar && smallScreenNavigation ? { paddingLeft: 5 } : null,
            ]}
        >
            <Icon name="circle" color={color} size={24} />

            {inInteractionBar ? (
                <Text style={localStyles.text}>{name}</Text>
            ) : (
                <LinealParser parentWidth={width} dotsStyle={styles.body1}>
                    <Text style={localStyles.text}>{name}</Text>
                </LinealParser>
            )}
        </View>
    )

    return showInteractionBar ? (
        <FeedInteractionBar
            FeedModel={FeedModel}
            setShowInteractionBar={setShowInteractionBar}
            feedObjectType={type}
            projectId={projectId}
            feed={feed}
            isHeaderObject={true}
        />
    ) : (
        <TouchableOpacity onPress={openInteractionBar} disabled={activeModalInFeed}>
            <FeedModel />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        paddingVertical: 8,
    },
    expanded: {
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
})
