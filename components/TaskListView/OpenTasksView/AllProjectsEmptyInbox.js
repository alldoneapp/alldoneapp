import React from 'react'
import { View } from 'react-native'

import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import AllProjectsEmptyInboxText from './AllProjectsEmptyInboxText'
import AllProjectsEmptyInboxPicture from './AllProjectsEmptyInboxPicture'

export default function AllProjectsEmptyInbox() {
    return (
        <View style={localStyles.emptyInbox}>
            <AllProjectsEmptyInboxText />
            <AllProjectsEmptyInboxPicture />
            <AllProjectsEmptyInboxTags />
        </View>
    )
}

const localStyles = {
    emptyInbox: {
        flex: 1,
        marginTop: 32,
        alignItems: 'center',
    },
}
