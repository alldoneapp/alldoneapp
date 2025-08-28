import React from 'react'
import { StyleSheet, View } from 'react-native'

import EditorAvatarWrapper from './EditorAvatarWrapper'
import PlusButtonWrapper from './PlusButtonWrapper'
import { MAX_EDITORS_TO_SHOW } from './EditorsConstants'
import { useSelector } from 'react-redux'

export default function EditorsGroup({ editorsInfo, users, peersSynced, markAssignee = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const editors = []
    const editorsToShow = []
    let count = 0
    for (let i = 0; i < editorsInfo.length; i++) {
        for (let j = 0; j < users.length; j++) {
            if (editorsInfo[i].id === users[j].uid) {
                count++
                const user = { ...users[j], color: editorsInfo[i].color }
                editors.push(user)

                if (mobile && editorsToShow.length === 0) {
                    editorsToShow.push(user)
                } else if (!mobile && count <= MAX_EDITORS_TO_SHOW) {
                    editorsToShow.push(user)
                }
            }
        }
    }

    return (
        <View style={localStyles.container}>
            {editorsToShow.map((user, index) => {
                if ((user && index === 0 && !peersSynced) || (user && peersSynced)) {
                    return (
                        <View
                            key={user.uid}
                            style={editorsToShow.length > 1 && index > 0 ? localStyles.avatarOverlap : null}
                        >
                            <EditorAvatarWrapper
                                key={user.uid}
                                avatarUrl={user.photoURL}
                                avatarColor={user.color}
                                editors={editors}
                                markAssignee={markAssignee}
                            />
                        </View>
                    )
                } else {
                    return null
                }
            })}

            {!mobile && editors.length > MAX_EDITORS_TO_SHOW && peersSynced && (
                <PlusButtonWrapper editors={editors} markAssignee={markAssignee} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarOverlap: {
        marginLeft: -12,
    },
})
