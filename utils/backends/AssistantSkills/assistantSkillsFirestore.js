import { getDb, getId, globalWatcherUnsub, runHttpsCallableFunction } from '../firestore'
import store from '../../../redux/store'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { GLOBAL_PROJECT_ID } from '../../../components/AdminPanel/Assistants/assistantsHelper'

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

function getSkillsCollectionPath() {
    return `assistantSkills/${GLOBAL_PROJECT_ID}/items`
}

export async function getAssistantSkillData(skillId) {
    const skill = (await getDb().doc(`${getSkillsCollectionPath()}/${skillId}`).get()).data()
    if (skill) skill.uid = skillId
    return skill
}

export async function getGlobalAssistantSkills() {
    const skillDocs = (await getDb().collection(getSkillsCollectionPath()).orderBy('lastEditionDate', 'desc').get())
        .docs
    const skills = []
    skillDocs.forEach(doc => {
        const skill = doc.data()
        skill.uid = doc.id
        skills.push(skill)
    })
    return skills
}

export function watchGlobalAssistantSkills(watcherKey, callback) {
    let firstSnap = true
    store.dispatch(startLoadingData())
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(getSkillsCollectionPath())
        .orderBy('lastEditionDate', 'desc')
        .onSnapshot(skillDocs => {
            const skills = []
            skillDocs.forEach(doc => {
                const skill = doc.data()
                skill.uid = doc.id
                skills.push(skill)
            })
            callback(skills)
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

export async function uploadNewAssistantSkill(skill) {
    const { loggedUser } = store.getState()
    updateEditionData(skill)

    skill.uid = getId()
    skill.name = skill.name.trim()
    skill.displayName = skill.displayName.trim()
    skill.createdDate = Date.now()
    skill.creatorId = loggedUser.uid

    const skillToStore = { ...skill }
    delete skillToStore.uid

    await getDb().doc(`${getSkillsCollectionPath()}/${skill.uid}`).set(skillToStore)
    return skill
}

export async function updateAssistantSkill(updatedSkill) {
    const skillToStore = { ...updatedSkill }
    delete skillToStore.uid
    updateEditionData(skillToStore)
    await getDb().doc(`${getSkillsCollectionPath()}/${updatedSkill.uid}`).update(skillToStore)
}

export async function deleteAssistantSkill(skillId) {
    await getDb().doc(`${getSkillsCollectionPath()}/${skillId}`).delete()
}

//MARKETPLACE IMPORT

export async function importAssistantSkillsFromRepo(repoUrl, ref) {
    const result = await runHttpsCallableFunction(
        'importAssistantSkillsFromRepo',
        { repoUrl, ref: ref || null },
        { timeout: 300000 }
    )
    return result?.data || result
}

export function watchPendingSkillImports(watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection('assistantSkillImports')
        .where('status', '==', 'pendingReview')
        .onSnapshot(importDocs => {
            const imports = []
            importDocs.forEach(doc => {
                const stagedImport = doc.data()
                stagedImport.uid = doc.id
                imports.push(stagedImport)
            })
            imports.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0) || a.name.localeCompare(b.name))
            callback(imports)
        })
}

// Approving creates the skill at the staged proposedSkillId (its bundled files
// were already uploaded under that id). If a catalog skill with the same name
// exists, its content is overwritten in place instead (version bump) so
// re-imports act as updates.
export async function approveAssistantSkillImport(stagedImport, existingSkills) {
    const { loggedUser } = store.getState()
    const existing = (existingSkills || []).find(skill => skill.name === stagedImport.name)
    const skillData = {
        name: stagedImport.name,
        displayName: stagedImport.displayName || stagedImport.name,
        description: stagedImport.description || '',
        body: stagedImport.body || '',
        files: Array.isArray(stagedImport.files) ? stagedImport.files : [],
        source: stagedImport.source || { type: 'import' },
        enabled: true,
        lastEditionDate: Date.now(),
        lastEditorId: loggedUser.uid,
    }
    if (existing) {
        skillData.version = (Number(existing.version) || 1) + 1
        await getDb().doc(`${getSkillsCollectionPath()}/${existing.uid}`).update(skillData)
    } else {
        skillData.version = 1
        skillData.createdDate = Date.now()
        skillData.creatorId = loggedUser.uid
        const skillId = stagedImport.proposedSkillId || getId()
        await getDb().doc(`${getSkillsCollectionPath()}/${skillId}`).set(skillData)
    }
    await getDb().doc(`assistantSkillImports/${stagedImport.uid}`).update({ status: 'approved' })
}

export async function dismissAssistantSkillImport(importId) {
    await getDb().doc(`assistantSkillImports/${importId}`).update({ status: 'dismissed' })
}
