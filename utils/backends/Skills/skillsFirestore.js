import { firebase } from '@firebase/app'
import { intersection, isEqual, orderBy, uniq } from 'lodash'

import TasksHelper, { GENERIC_SKILL_TYPE } from '../../../components/TaskListView/Utils/TasksHelper'
import {
    createGenericTaskWhenMentionInTitleEdition,
    generateSortIndex,
    getDb,
    getId,
    getMentionedUsersIdsWhenEditText,
    getObjectFollowersIds,
    globalWatcherUnsub,
    logEvent,
    mapSkillData,
} from '../firestore'
import store from '../../../redux/store'
import { setSkillsByProject, setSkillsDefaultPrivacy, stopLoadingData } from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import {
    createSkillAssistantChangedFeed,
    createSkillUpdatesChain,
    deleteSkillUpdatesChain,
    skillCompletionChangedUpdatesChain,
    skillDescriptionChangedUpdatesChain,
    skillHighlightChangdeUpdatesChain,
    skillNameChangedUpdatesChain,
    skillPointsChangdeUpdatesChain,
    skillPrivacyChangedUpdatesChain,
    updateSkillFeedsChain,
} from './skillUpdates'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'

import { createGenericTaskWhenMention } from '../Tasks/tasksFirestore'
import { updateNotePrivacy, updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import {
    updateChatAssistantWithoutFeeds,
    updateChatPrivacy,
    updateChatTitleWithoutFeeds,
} from '../Chats/chatsFirestore'

//ACCESS FUNCTIONS

export async function getSkillData(projectId, skillId) {
    const skill = (await getDb().doc(`/skills/${projectId}/items/${skillId}`).get()).data()
    return skill ? mapSkillData(skillId, skill) : null
}

export function watchSkill(projectId, skillId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`skills/${projectId}/items/${skillId}`)
        .onSnapshot(skillDoc => {
            const skillData = skillDoc.data()
            const skill = skillData ? mapSkillData(skillId, skillData) : null
            callback(skill)
        })
}

export function watchSkills(projectId, userId, watcherKey) {
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`skills/${projectId}/items`)
        .where('userId', '==', userId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .onSnapshot(skillsDocs => {
            let skills = []
            skillsDocs.forEach(doc => {
                const skill = mapSkillData(doc.id, doc.data())
                skills.push(skill)
            })
            skills = orderBy(skills, 'sortIndex', 'asc')
            store.dispatch(setSkillsByProject(projectId, skills))
            store.dispatch(stopLoadingData())
        })
}

//EDTION AND ADITION FUNCTIONS

export const updateSkillEditionData = async (projectId, skillId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`skills/${projectId}/items/${skillId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

async function updateSkillData(projectId, skillId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`skills/${projectId}/items/${skillId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export function uploadNewSkill(projectId, skill, isUpdatingProject, oldProject, callback) {
    updateEditionData(skill)

    skill.id = skill.id ? skill.id : getId()
    skill.extendedName = skill.extendedName.trim()
    skill.created = Date.now()
    skill.lastEditionDate = skill.created

    const skillToStore = { ...skill }
    delete skillToStore.id

    const batch = new BatchWrapper(getDb())
    batch.set(getDb().doc(`skills/${projectId}/items/${skill.id}`), skillToStore, { merge: true })

    if (skill.points) {
        batch.update(getDb().doc(`users/${skill.userId}`), {
            skillPoints: firebase.firestore.FieldValue.increment(-skill.points),
        })
    }

    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(skill.extendedName)

    const project = ProjectHelper.getProjectById(projectId)
    const fullText = skill.extendedTitle + ' ' + skill.description
    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

    createGenericTaskWhenMention(projectId, skill.id, mentionedUserIds, GENERIC_SKILL_TYPE, 'skills', skill.assistantId)

    const mentionedUserIdsInDescription = TasksHelper.getMentionIdsFromTitle(skill.description)
    createGenericTaskWhenMention(
        projectId,
        skill.id,
        mentionedUserIdsInDescription,
        GENERIC_SKILL_TYPE,
        'skills',
        skill.assistantId
    )

    batch.commit().then(() => {
        createSkillUpdatesChain(projectId, skill, isUpdatingProject, oldProject)
        callback?.(skill)
    })

    logEvent('new_skill', {
        id: skill.id,
        name: cleanedTitle,
    })

    return skill
}

export function updateSkillProject(oldProject, newProject, skill, callback) {
    const oldProjectId = oldProject.id
    const newProjectId = newProject.id

    const { projectUsers } = store.getState()
    const newProjectUsers = projectUsers[newProjectId]

    let isPublicFor
    if (skill.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        isPublicFor = [FEED_PUBLIC_FOR_ALL]
    } else {
        const usersWithAccess = newProjectUsers.filter(user => skill.isPublicFor.includes(user.uid))
        isPublicFor = usersWithAccess.map(user => user.uid)
    }

    deleteSkill(oldProjectId, skill, newProject.id, newProject)
    uploadNewSkill(
        newProjectId,
        {
            ...skill,
            isPublicFor,
        },
        true,
        oldProject,
        callback
    )
}

export function updateSkill(projectId, oldSkill, updatedSkill, avoidFollow) {
    updatedSkill.extendedName = updatedSkill.extendedName.trim()

    const skillToStore = { ...updatedSkill }
    delete skillToStore.id

    const batch = new BatchWrapper(getDb())

    if (!isEqual(oldSkill.isPublicFor, updatedSkill.isPublicFor)) {
        if (updatedSkill.noteId) {
            getObjectFollowersIds(projectId, 'skills', updatedSkill.id).then(followersIds => {
                updateNotePrivacy(
                    projectId,
                    updatedSkill.noteId,
                    !updatedSkill.isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
                    updatedSkill.isPublicFor,
                    followersIds,
                    false,
                    null
                )
            })
        }
        updateChatPrivacy(projectId, updatedSkill.id, 'skills', updatedSkill.isPublicFor)
    }

    if (oldSkill.extendedName !== updatedSkill.extendedName) {
        updateChatTitleWithoutFeeds(projectId, updatedSkill.id, updatedSkill.extendedName)
        if (updatedSkill.noteId) updateNoteTitleWithoutFeed(projectId, updatedSkill.noteId, updatedSkill.extendedName)

        createGenericTaskWhenMentionInTitleEdition(
            projectId,
            updatedSkill.id,
            updatedSkill.extendedName,
            oldSkill.extendedName,
            GENERIC_SKILL_TYPE,
            'skills',
            updatedSkill.assistantId
        )
    }

    if (oldSkill.description !== updatedSkill.description) {
        createGenericTaskWhenMentionInTitleEdition(
            projectId,
            updatedSkill.id,
            updatedSkill.description,
            oldSkill.description,
            GENERIC_SKILL_TYPE,
            'skills',
            updatedSkill.assistantId
        )
    }

    if (oldSkill.points !== updatedSkill.points) {
        const loggedUserId = store.getState().loggedUser.uid
        const pointsToAdd = updatedSkill.points - oldSkill.points
        skillToStore.points = firebase.firestore.FieldValue.increment(pointsToAdd)
        batch.update(getDb().doc(`users/${loggedUserId}`), {
            skillPoints: firebase.firestore.FieldValue.increment(-pointsToAdd),
        })
    }

    updateSkillData(projectId, updatedSkill.id, skillToStore, batch)

    batch.commit()

    updateSkillFeedsChain(projectId, updatedSkill, oldSkill, avoidFollow)
}

export function updateSkillPoints(projectId, skill, pointsToAdd) {
    const { loggedUser } = store.getState()

    const batch = new BatchWrapper(getDb())
    updateSkillData(projectId, skill.id, { points: firebase.firestore.FieldValue.increment(pointsToAdd) }, batch)
    batch.update(getDb().doc(`users/${loggedUser.uid}`), {
        skillPoints: firebase.firestore.FieldValue.increment(-pointsToAdd),
    })
    batch.commit()

    skillPointsChangdeUpdatesChain(projectId, skill, skill.points, skill.points + pointsToAdd)
}

export const setSkillAssistant = async (projectId, skillId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateSkillData(projectId, skillId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, skillId, assistantId, batch)
    batch.commit()
    if (needGenerateUpdate) createSkillAssistantChangedFeed(projectId, assistantId, skillId, null)
}

export function updateSkillPrivacy(projectId, skill, isPublicFor) {
    updateSkillData(projectId, skill.id, { isPublicFor }, null)
    updateChatPrivacy(projectId, skill.id, 'skills', isPublicFor)
    if (skill.noteId) {
        getObjectFollowersIds(projectId, 'skills', skill.id).then(followersIds => {
            updateNotePrivacy(
                projectId,
                skill.noteId,
                !isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
                isPublicFor,
                followersIds,
                false,
                null
            )
        })
    }
    skillPrivacyChangedUpdatesChain(projectId, skill, isPublicFor)
}

export async function updateSkillDescription(projectId, skill, description) {
    updateSkillData(projectId, skill.id, { description }, null)

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        skill.id,
        description,
        skill.description,
        GENERIC_SKILL_TYPE,
        'skills',
        skill.assistantId
    )

    skillDescriptionChangedUpdatesChain(projectId, skill, skill.description, description)
}

export function updateSkillHighlight(projectId, hasStar, skill) {
    updateSkillData(projectId, skill.id, { hasStar }, null)
    skillHighlightChangdeUpdatesChain(projectId, skill, hasStar)
}

export function updateSkillCompletion(projectId, completion, skill) {
    updateSkillData(projectId, skill.id, { completion }, null)
    skillCompletionChangedUpdatesChain(projectId, skill, completion)
}

export async function updateSkillNote(projectId, skillId, noteId) {
    await updateSkillData(projectId, skillId, { noteId }, null)
}

export async function updateSkillName(projectId, newName, skill) {
    const cleanedTitle = TasksHelper.getTaskNameWithoutMeta(newName)
    updateSkillData(projectId, skill.id, { name: cleanedTitle.toLowerCase(), extendedName: newName }, null)
    updateChatTitleWithoutFeeds(projectId, skill.id, newName)

    if (skill.noteId) {
        updateNoteTitleWithoutFeed(projectId, skill.noteId, newName)
    }

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        skill.id,
        newName,
        skill.extendedName,
        GENERIC_SKILL_TYPE,
        'skills',
        skill.assistantId
    )
    skillNameChangedUpdatesChain(projectId, skill, skill.extendedName, newName)
}

export function updateSkillSortIndex(projectId, skillId, batch) {
    const sortIndex = generateSortIndex()
    batch.update(getDb().doc(`skills/${projectId}/items/${skillId}`), {
        sortIndex,
    })
    return sortIndex
}

export async function deleteSkill(projectId, skill, movingToOtherProjectId, newProject) {
    if (movingToOtherProjectId)
        await getDb().doc(`skills/${projectId}/items/${skill.id}`).update({ movingToOtherProjectId })
    await getDb().doc(`skills/${projectId}/items/${skill.id}`).delete()
    deleteSkillUpdatesChain(projectId, skill, movingToOtherProjectId, newProject)
}

export function resetSkills(projectId) {
    const { skillsByProject } = store.getState()
    const skills = skillsByProject[projectId] ? skillsByProject[projectId] : []

    skills.forEach(skill => {
        deleteSkill(projectId, skill, '', null)
    })
}

export const updateSkillLastCommentData = async (projectId, skillId, lastComment, lastCommentType) => {
    getDb()
        .doc(`skills/${projectId}/items/${skillId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

//OTHERS FUNCTIONS

export function watchDefaultSkillsPrivacy(projectId, userId, watcherKey) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`skillsDefaultPrivacy/${projectId}/items/${userId}`)
        .onSnapshot(privacyDoc => {
            const privacyData = privacyDoc.data()
            const defaultPrivacy = privacyData ? privacyData : { isPublicFor: [FEED_PUBLIC_FOR_ALL] }
            store.dispatch(setSkillsDefaultPrivacy(projectId, defaultPrivacy.isPublicFor))
        })
}

export function updateDefaultSkillsPrivacy(projectId, userId, isPublicFor) {
    getDb().doc(`skillsDefaultPrivacy/${projectId}/items/${userId}`).set({ isPublicFor })
}
