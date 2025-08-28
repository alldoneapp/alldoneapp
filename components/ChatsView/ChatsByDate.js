import React, { useRef } from 'react'
import DismissibleItem from '../UIComponents/DismissibleItem'
import AddChat from './AddChat'
import DateHeader from './DateHeader'
import EditChat from './EditChat'
import ChatItem from './ChatItem'
import { isSomeChatEditOpen } from './Utils/ChatHelper'

const ChatsByDate = ({ project, date, dateString, data }) => {
    const isToday = dateString === 'TODAY'
    let itemRef = useRef()
    let dismissibleRefs = {}

    return (
        <>
            <DateHeader isToday={isToday} dateText={dateString} date={date} />

            {isToday && (
                <DismissibleItem
                    ref={itemRef}
                    defaultComponent={
                        <AddChat onPress={() => !isSomeChatEditOpen() && itemRef?.current?.toggleModal()} />
                    }
                    modalComponent={
                        <EditChat
                            formType={'new'}
                            projectId={project.id}
                            onCancelAction={() => {
                                itemRef?.current?.toggleModal()
                            }}
                        />
                    }
                />
            )}

            {data &&
                data.map(item => {
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
        </>
    )
}

export default ChatsByDate
