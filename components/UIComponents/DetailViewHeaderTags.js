import React, { useState } from 'react'
import { View } from 'react-native'
import styles from './detailViewHeaderStyles'

export default function DetailViewHeaderTags({ projectTag, privacyTag, children, actions }) {
    const [privacyWidth, setPrivacyWidth] = useState(24)
    // Measure the visibility tag: translations and private participant avatars
    // have different widths. Keep at least the project icon beside that tag;
    // move actions to the next row when the container cannot accommodate both.
    // A caller may leave the visibility tag out (the task header moves the default "Project-wide"
    // tag into its overflow menu, AT-3081); then there is nothing to measure or reserve.
    const minimumTagsWidth = Math.max(72, (privacyTag ? privacyWidth : 0) + (projectTag ? 36 : 0))

    return (
        <View style={styles.container}>
            <View style={[styles.tagList, { minWidth: minimumTagsWidth }]}>
                <View style={styles.primaryTags}>
                    {projectTag && <View style={styles.projectTag}>{projectTag}</View>}
                    {privacyTag && (
                        <View onLayout={({ nativeEvent }) => setPrivacyWidth(nativeEvent.layout.width)}>
                            {privacyTag}
                        </View>
                    )}
                </View>
                {children}
            </View>
            <View style={styles.actions}>{actions}</View>
        </View>
    )
}
