import React, { useRef } from 'react'
import { StyleSheet } from 'react-native'

import MoreButtonWrapper from '../MorePopupsOfMainViews/Common/MoreButtonWrapper'
import PrepareMeetingsItem from './PrepareMeetingsItem'

export default function CalendarSectionMoreButton({ projectId, tasks }) {
    const modalRef = useRef(null)
    return (
        <MoreButtonWrapper ref={modalRef} buttonStyle={localStyles.button} wrapperStyle={localStyles.wrapper}>
            <PrepareMeetingsItem
                projectId={projectId}
                tasks={tasks}
                shortcut="1"
                closeModal={() => modalRef.current?.close()}
            />
        </MoreButtonWrapper>
    )
}

const localStyles = StyleSheet.create({
    wrapper: { marginLeft: 8 },
    button: { maxHeight: 20, maxWidth: 20, paddingVertical: 0, minHeight: 20 },
})
