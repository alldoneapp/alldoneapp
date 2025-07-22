import React, { useRef } from 'react'
import { StyleSheet } from 'react-native'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import DateBarOrganizeModalItem from './DateBarOrganizeModalItem'

export default function TaskDateBarMoreButton({ projectId, dateIndex, instanceKey }) {
    const modalRef = useRef(null)

    const dismissModal = () => {
        modalRef.current.close()
    }

    return (
        <MoreButtonWrapper ref={modalRef} buttonStyle={localStyles.buttonStyle} shortcut="M">
            <DateBarOrganizeModalItem
                shortcut="1"
                text="Organize"
                onPress={dismissModal}
                projectId={projectId}
                dateIndex={dateIndex}
                instanceKey={instanceKey}
                icon="multi-selection"
            />
            <DateBarOrganizeModalItem
                shortcut="2"
                text="Select all"
                onPress={dismissModal}
                projectId={projectId}
                dateIndex={dateIndex}
                instanceKey={instanceKey}
                selectTasks={true}
                icon="multi-selection-selected"
            />
        </MoreButtonWrapper>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        maxHeight: 20,
        maxWidth: 20,
        paddingVertical: 0,
        minHeight: 20,
    },
})
