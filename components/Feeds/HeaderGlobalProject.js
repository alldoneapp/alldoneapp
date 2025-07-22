import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import FollowSwitchableTag from './FollowSwitchableTag/FollowSwitchableTag'
import UpdatesMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Updates/UpdatesMoreButton'
import { translate } from '../../i18n/TranslationService'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function HeaderGlobalProject({
    smallScreenNavigation,
    setAmountFollowedFeeds,
    setAmountAllFeeds,
    amountFollowedFeeds,
    amountAllFeeds,
    projectId,
    selectedUser,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [open, setOpen] = useState(false)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

    return (
        <View style={localStyles.container}>
            <Popover
                content={<ChangeObjectListModal closePopover={() => setOpen(false)} />}
                onClickOutside={() => setOpen(false)}
                isOpen={open}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'start'}
                contentLocation={mobile ? null : undefined}
            >
                <TouchableOpacity disabled={!accessGranted} accessible={false} onPress={() => setOpen(true)}>
                    <Text style={localStyles.title}>{translate('Updates')}</Text>
                </TouchableOpacity>
            </Popover>

            <UpdatesMoreButton projectId={projectId} user={selectedUser} />
            <View style={localStyles.followTag}>
                <FollowSwitchableTag
                    smallScreenNavigation={smallScreenNavigation}
                    setAmountFollowedFeeds={setAmountFollowedFeeds}
                    setAmountAllFeeds={setAmountAllFeeds}
                    amountFollowedFeeds={amountFollowedFeeds}
                    amountAllFeeds={amountAllFeeds}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 80,
        minHeight: 80,
        maxHeight: 80,
        paddingTop: 40,
        paddingBottom: 8,
    },
    title: {
        ...styles.title5,
        color: colors.Text01,
    },
    followTag: {
        flex: 1,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
})
