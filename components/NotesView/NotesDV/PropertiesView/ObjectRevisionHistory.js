import React from 'react'
import { View } from 'react-native'

import SaveVersion from './SaveVersion'
import VersionHistory from './VersionHistory'
import useObjectNote from '../../../../hooks/useObjectNote'

export default function ObjectRevisionHistory({ projectId, noteId }) {
    const note = useObjectNote(projectId, noteId)

    return note ? (
        <View>
            <SaveVersion projectId={projectId} note={note} />
            <VersionHistory projectId={projectId} note={note} />
        </View>
    ) : null
}
