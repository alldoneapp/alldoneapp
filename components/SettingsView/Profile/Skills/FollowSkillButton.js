import React from 'react'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'
import useFollowingDataListener from '../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/useFollowingDataListener'
import { FOLLOWER_SKILLS_TYPE } from '../../../Followers/FollowerConstants'

export default function FollowSkillButton({ projectId, skill, onCancelAction }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useFollowingDataListener(projectId, FOLLOWER_SKILLS_TYPE, skill.id)

    const followData = {
        followObjectsType: FOLLOWER_SKILLS_TYPE,
        followObjectId: skill.id,
        followObject: skill,
        feedCreator: loggedUser,
    }

    const followObject = () => {
        Backend.addFollower(projectId, followData)
        onCancelAction()
    }

    const unfollowObject = () => {
        Backend.removeFollower(projectId, followData)
        onCancelAction()
    }

    const toggleFollowState = () => {
        active ? unfollowObject() : followObject()
    }

    return (
        <Hotkeys
            keyName={'alt+W'}
            onKeyDown={(sht, event) => execShortcutFn(this.followBtnRef, toggleFollowState, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.followBtnRef = ref)}
                title={smallScreen ? null : translate(active ? 'Following' : 'Not following')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={active ? 'eye' : 'eye-off'}
                buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                onPress={toggleFollowState}
                shortcutText={'W'}
            />
        </Hotkeys>
    )
}
