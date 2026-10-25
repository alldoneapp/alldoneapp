import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import useWindowSize from '../../utils/useWindowSize'

// Room left for the app's top bar, the project header and the artifact's own title row.
const CHROME_HEIGHT = 240
const MIN_CHAT_HEIGHT = 360

export function getArtifactChatHeight(windowHeight) {
    return Math.max(MIN_CHAT_HEIGHT, (Number(windowHeight) || 0) - CHROME_HEIGHT)
}

// The artifact's conversation: the same chat a note or a skill has, stored under the `artifacts`
// chat type. The artifact view is a page that scrolls as a whole, while the chat scrolls its
// messages itself and keeps the composer at the bottom, so it gets a box of its own height.
export default function ArtifactChat({ projectId, artifact }) {
    const [, windowHeight] = useWindowSize()
    const [assistantId, setAssistantId] = useState(artifact.assistantId)

    useEffect(() => {
        setAssistantId(artifact.assistantId)
    }, [artifact.id, artifact.assistantId])

    return (
        <View testID="artifact-chat" style={[localStyles.container, { height: getArtifactChatHeight(windowHeight) }]}>
            <ChatBoard
                chat={{ id: artifact.id, type: 'artifacts' }}
                projectId={projectId}
                parentObject={artifact}
                chatTitle={artifact.title}
                assistantId={assistantId}
                setAssistantId={setAssistantId}
                objectType="artifacts"
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 8,
    },
})
