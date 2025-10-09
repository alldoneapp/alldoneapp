import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import TaskTitle, { TITLE_TASK } from './TaskTitle'
import Indicator from './Indicator'
import TagList from './TagList'
import { colors } from '../../styles/global'
import BackButton from './BackButton'
import SharedHelper from '../../../utils/SharedHelper'
import DVHamburgButton from '../../UIControls/DVHamburgButton'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Icon from '../../Icon'
import { useSelector } from 'react-redux'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'

const Header = ({ projectId, task, navigation, isFullscreen, setFullscreen }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const photoURL = useSelector(state => state.assignee.photoURL)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const taskTitleInEditMode = useSelector(state => state.taskTitleInEditMode)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <View style={[localStyles.container, isFullscreen && { paddingBottom: 8 }]}>
            <View style={[localStyles.upperHeader, isFullscreen && { paddingBottom: 16 }]}>
                {isMiddleScreen && accessGranted && (
                    <View style={localStyles.backButtonMobile}>
                        <BackButton projectId={projectId} task={task} />
                    </View>
                )}

                {mobile && loggedUser.isAnonymous && (
                    <View style={localStyles.backButtonMobile}>
                        <DVHamburgButton navigation={navigation} />
                    </View>
                )}

                <View style={{ marginRight: 'auto', flex: 1 }}>
                    <TaskTitle
                        projectId={projectId}
                        task={task}
                        title={task.extendedName || task.name}
                        object={task}
                        titleType={TITLE_TASK}
                    />
                </View>
                <View>{!taskTitleInEditMode ? <Indicator isSubtask={task.parentId} /> : null}</View>
            </View>

            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    {task?.userId?.startsWith(WORKSTREAM_ID_PREFIX) ? (
                        <Icon size={24} name="workstream" color={colors.Text03} style={localStyles.userImage} />
                    ) : photoURL != null && photoURL !== '' ? (
                        <Image style={localStyles.userImage} source={{ uri: photoURL }} />
                    ) : (
                        <View style={localStyles.userImage}>
                            <SVGGenericUser width={24} height={24} svgid={`ci_p_task_h_${projectId}`} />
                        </View>
                    )}
                    <TagList projectId={projectId} task={task} />
                </View>
            )}
            {isFullscreen && selectedTab === DV_TAB_TASK_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={task.id}
                        assistantId={task.assistantId}
                        projectId={projectId}
                        objectType={'tasks'}
                        parentObject={task}
                    />
                </View>
            )}
        </View>
    )
}

export default Header

const localStyles = StyleSheet.create({
    container: {
        minHeight: 140,
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingBottom: 24,
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingBottom: 32,
    },
    bottomHeader: {
        flexDirection: 'row',
    },
    userImage: {
        backgroundColor: '#ffffff',
        height: 24,
        width: 24,
        borderRadius: 100,
        marginRight: 12,
        overflow: 'hidden',
    },
    backButtonMobile: {
        left: -16,
    },
})
