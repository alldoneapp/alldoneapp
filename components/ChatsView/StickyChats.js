import React, { useRef } from 'react'
import { View } from 'react-native'
import DismissibleItem from '../UIComponents/DismissibleItem'
import ChatItem from './ChatItem'
import { isSomeChatEditOpen } from './Utils/ChatHelper'
import EditChat from './EditChat'

export default function StickyChats({ project, stickyChats }) {
    let dismissibleRefs = {}
    return (
        <View style={{ marginTop: 8 }}>
            {stickyChats.map(item => {
                return (
                    <DismissibleItem
                        key={item.id}
                        ref={ref => {
                            if (ref) {
                                dismissibleRefs[`${item.id}`] = ref
                            }
                        }}
                        defaultComponent={
                            <ChatItem
                                chat={item}
                                project={project}
                                openEditModal={() => {
                                    !isSomeChatEditOpen() && dismissibleRefs[`${item.id}`].openModal()
                                }}
                            />
                        }
                        modalComponent={
                            <EditChat
                                formType={'edit'}
                                project={project}
                                projectId={project.id}
                                onCancelAction={() => {
                                    dismissibleRefs[`${item.id}`].toggleModal()
                                }}
                                chat={item}
                            />
                        }
                    />
                )
            })}
        </View>
    )
}
