import React, { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import LimitModal from '../Premium/LimitModal/LimitModal'
import FreePlanWarning from '../Premium/FreePlanWarning'
import LimitedFeatureModal from '../Premium/LimitedFeatureModal'
import LimitModalPremium from '../Premium/LimitModalPremium/LimitModalPremium'
import LevelUpModal from './FloatModals/LevelUpModal/LevelUpModal'
import ChangeContactInfoModalContainerForNewGuideUsers from './FloatModals/ChangeContactInfoModalContainerForNewGuideUsers'
import BotWarningModal from '../ChatsView/ChatDV/EditorView/BotOption/BotWarningModal'
import RecordVideo from '../MediaBar/RecordVideo/RecordVideo'
import { updateRecordVideoModalData, updateScreenRecordingModalData } from '../../redux/actions'
import NotAvailableScreenRecording from '../MediaBar/ScreenRecording/NotAvailableScreenRecording'
import ScreenRecording from '../MediaBar/ScreenRecording/ScreenRecording'
import ChatGoogleMeetModal from '../ChatsView/ChatDV/EditorView/ChatGoogleMeetModal'
import GoogleMeetModal from '../GoogleCalendar/GoogleMeetModal'
import GoogleMeetNotificationModal from '../GoogleCalendar/GoogleMeetNotificationModal'
import TaskSuggestedComment from '../Suggeted/TaskSuggestedComment'
import GlobalSearchModal from '../GlobalSearchAlgolia/GlobalSearchModal'
import AccessDeniedPopup from './AccessDeniedPopup'
import ConfirmPopup from './ConfirmPopup'
import CheatSheetModal from './ShortcutCheatSheet/CheatSheetModal'
import EndCopyProjectNotification from '../ProjectDetailedView/ProjectProperties/CopyProject/EndCopyProjectNotification'
import NotificationModalOptional from './FloatModals/NotificationModalOptional'
import TaskCompletionAnimation from '../TaskListView/TaskItem/TaskCompletionAnimation'
import IframeModal from './FloatModals/IframeModal/IframeModal'
import GlobalPreConfigTaskModal from './FloatModals/PreConfigTaskGeneratorModal/GlobalPreConfigTaskModal'

export default function GlobalModalsContainerApp() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const showUserInfoModalWhenUserJoinsToGuide = useSelector(state => state.showUserInfoModalWhenUserJoinsToGuide)
    const showLimitQuotaModal = useSelector(state => state.limitQuotaModalData.visible)
    const showLimitPremiumQuotaModal = useSelector(state => state.showLimitPremiumQuotaModal)
    const showLimitedFeatureModal = useSelector(state => state.showLimitedFeatureModal)
    const newEarnedSkillPoints = useSelector(state => state.loggedUser.newEarnedSkillPoints)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const recordVideoModalData = useSelector(state => state.recordVideoModalData)
    const screenRecordingModalData = useSelector(state => state.screenRecordingModalData)
    const chatGoogleMeetModalData = useSelector(state => state.chatGoogleMeetModalData)
    const googleMeetModalData = useSelector(state => state.googleMeetModalData)
    const googleMeetNotificationModalData = useSelector(state => state.googleMeetNotificationModalData)
    const taskSuggestedCommentModalData = useSelector(state => state.taskSuggestedCommentModalData)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const showAccessDeniedPopup = useSelector(state => state.showAccessDeniedPopup)
    const confirmPopupDataVisible = useSelector(state => state.showConfirmPopupData.visible)
    const showCheatSheet = useSelector(state => state.showCheatSheet)
    const showEndCopyProjectPopupData = useSelector(state => state.endCopyProjectPopupData.visible)
    const showOptionalVersionNotification = useSelector(state => state.showOptionalVersionNotification)
    const showTaskCompletionAnimation = useSelector(state => state.showTaskCompletionAnimation)
    const [showLevelUpModal, setShowLevelUpModal] = useState(false)

    useEffect(() => {
        if (newEarnedSkillPoints > 0 && !showLevelUpModal) setShowLevelUpModal(true)
    }, [newEarnedSkillPoints])

    return (
        <>
            {showTaskCompletionAnimation && (
                <TaskCompletionAnimation
                    visible={showTaskCompletionAnimation}
                    onAnimationComplete={() => dispatch({ type: 'Hide task completion animation' })}
                />
            )}
            {showOptionalVersionNotification && <NotificationModalOptional />}
            {showEndCopyProjectPopupData && <EndCopyProjectNotification />}
            {showCheatSheet && !smallScreenNavigation && <CheatSheetModal />}
            {confirmPopupDataVisible && <ConfirmPopup />}
            {showAccessDeniedPopup && <AccessDeniedPopup />}
            {showGlobalSearchPopup && <GlobalSearchModal />}
            {taskSuggestedCommentModalData.visible && (
                <TaskSuggestedComment
                    projectId={taskSuggestedCommentModalData.projectId}
                    task={taskSuggestedCommentModalData.task}
                    taskName={taskSuggestedCommentModalData.taskName}
                />
            )}
            {googleMeetNotificationModalData.visible && (
                <GoogleMeetNotificationModal
                    projectId={googleMeetNotificationModalData.projectId}
                    userEmail={googleMeetNotificationModalData.email}
                    meeting={googleMeetNotificationModalData.meeting}
                />
            )}
            {googleMeetModalData.visible && (
                <GoogleMeetModal uid={googleMeetModalData.userId} projectId={googleMeetModalData.projectId} />
            )}
            {chatGoogleMeetModalData.visible && (
                <ChatGoogleMeetModal
                    uid={chatGoogleMeetModalData.userId}
                    title={chatGoogleMeetModalData.title}
                    selectedUsers={chatGoogleMeetModalData.userIds}
                    projectId={chatGoogleMeetModalData.projectId}
                />
            )}
            {recordVideoModalData.visible && (
                <RecordVideo
                    projectId={recordVideoModalData.projectId}
                    closeModal={() => {
                        dispatch(updateRecordVideoModalData(false, ''))
                    }}
                />
            )}
            {screenRecordingModalData.visible === true && (
                <ScreenRecording
                    projectId={screenRecordingModalData.projectId}
                    closeModal={() => {
                        dispatch(updateScreenRecordingModalData(false, ''))
                    }}
                />
            )}
            {screenRecordingModalData.visible === 'NotAvailable' && (
                <NotAvailableScreenRecording
                    onPress={() => {
                        dispatch(updateScreenRecordingModalData(false, ''))
                    }}
                />
            )}
            {showNotificationAboutTheBotBehavior && <BotWarningModal />}
            {showUserInfoModalWhenUserJoinsToGuide && <ChangeContactInfoModalContainerForNewGuideUsers />}
            {showLimitPremiumQuotaModal && <LimitModalPremium />}
            {showLimitQuotaModal && <LimitModal />}
            {loggedUserId && !isAnonymous && <FreePlanWarning />}
            {showLimitedFeatureModal && <LimitedFeatureModal />}
            {showLimitedFeatureModal && <LimitedFeatureModal />}
            {showLevelUpModal && !isAnonymous && <LevelUpModal setShowLevelUpModal={setShowLevelUpModal} />}
            <IframeModal />
            <GlobalPreConfigTaskModal />
        </>
    )
}
