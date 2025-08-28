import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import SheetHeader from './SheetHeader'
import { colors } from '../../styles/global'
import SingleNavBar, { SINGLE_NAV_BAR_LIGHT } from '../SingleNavBar/SingleNavBar'
import General from './Sections/General'
import Tasks from './Sections/Tasks'
import Notes from './Sections/Notes'
import CloseButton from '../../FollowUp/CloseButton'
import { setShowCheatSheet, hideFloatPopup } from '../../../redux/actions'
import Goals from './Sections/Goals'
import People from './Sections/People'
import Feed from './Sections/Feed'

export default function CheatSheetModal() {
    const dispatch = useDispatch()
    const navigationTabs = ['General', 'Tasks', 'Goals', 'Notes', 'Contacts', 'Updates']
    const [selectedTab, setSelectedTab] = useState(navigationTabs[0])

    const onSelectTab = tab => {
        setSelectedTab(tab)
    }

    const dismiss = e => {
        setTimeout(() => {
            dispatch([setShowCheatSheet(false), hideFloatPopup()])

            e.preventDefault()
            e.stopPropagation()
        }, 10)
    }

    return (
        <View style={localStyles.container}>
            <SheetHeader />
            <SingleNavBar
                tabs={navigationTabs}
                theme={SINGLE_NAV_BAR_LIGHT}
                onSelectTab={onSelectTab}
                style={{ marginTop: 8 }}
            />

            <CloseButton close={dismiss} style={{ top: 8, right: 8 }} />

            <View style={localStyles.body}>
                {(() => {
                    switch (selectedTab) {
                        case 'General':
                            return <General />
                        case 'Tasks':
                            return <Tasks />
                        case 'Goals':
                            return <Goals />
                        case 'Notes':
                            return <Notes />
                        case 'Contacts':
                            return <People />
                        case 'Updates':
                            return <Feed />
                    }
                })()}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 9000,
        left: 319,
        right: 56,
        bottom: 56,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 16,
    },
    body: {
        marginTop: 8,
    },
})
