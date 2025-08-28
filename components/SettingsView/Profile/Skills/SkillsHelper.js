import store from '../../../../redux/store'
import Backend from '../../../../utils/BackendBridge'
import { FEED_PUBLIC_FOR_ALL } from '../../../Feeds/Utils/FeedsConstants'

export function getNewDefaultSkill(projectId) {
    const { loggedUser, skillsDefaultPrivacyByProject } = store.getState()
    const isPublicFor = skillsDefaultPrivacyByProject[projectId]
        ? skillsDefaultPrivacyByProject[projectId]
        : [FEED_PUBLIC_FOR_ALL]
    return {
        extendedName: '',
        hasStar: '#FFFFFF',
        created: Date.now(),
        userId: loggedUser.uid,
        lastEditorId: loggedUser.uid,
        lastEditionDate: Date.now(),
        sortIndex: Backend.generateSortIndex(),
        isPublicFor,
        description: '',
        points: 0,
        noteId: null,
        completion: 0,
        assistantId: '',
        commentsData: null,
    }
}

export function isPrivateSkill(skill, customUserId) {
    const { loggedUser } = store.getState()
    const userId = customUserId ? customUserId : loggedUser.uid
    return (
        !skill ||
        loggedUser.isAnonymous ||
        (skill.isPublicFor && !skill.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !skill.isPublicFor.includes(userId))
    )
}
