import { getDb, getId, globalWatcherUnsub, runHttpsCallableFunction } from '../firestore'
import store from '../../../redux/store'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { GLOBAL_PROJECT_ID } from '../../../components/AdminPanel/Assistants/assistantsHelper'
import { BUILT_IN_ASSISTANT_SKILLS, mergeBuiltInAssistantSkills } from '../../AssistantSkills/builtInAssistantSkills'

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

function getSkillsCollectionPath() {
    return `assistantSkills/${GLOBAL_PROJECT_ID}/items`
}

export async function getAssistantSkillData(skillId) {
    const builtInSkill = BUILT_IN_ASSISTANT_SKILLS.find(skill => skill.uid === skillId || skill.name === skillId)
    if (builtInSkill) return builtInSkill

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
    return mergeBuiltInAssistantSkills(skills)
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
            callback(mergeBuiltInAssistantSkills(skills))
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

export async function uploadNewAssistantSkill(skill) {
    const { loggedUser } = store.getState()
    updateEditionData(skill)

    // A skill composed from an uploaded bundle has already had its files written
    // to Storage under a pre-allocated id (that path is part of every stored
    // `file.storagePath`), so honour an id the caller assigned.
    skill.uid = skill.uid || getId()
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

// FILE UPLOAD (AT-2431)

// A bundle has to be written to Storage under the skill's id BEFORE the skill
// document exists (every stored `file.storagePath` contains it), so the id is
// allocated up front — the same shape the repo import uses with its
// `proposedSkillId`.
export function getNewAssistantSkillId() {
    return getId()
}

// Bundled files are written by the server (the client has no Storage write
// grant under assistantSkills/**, and the relative path has to be validated
// somewhere the caller cannot reach — it becomes a path inside the VM sandbox).
export async function uploadAssistantSkillBundleFile(skillId, version, relativePath, contentBase64) {
    const result = await runHttpsCallableFunction(
        'uploadAssistantSkillFile',
        { skillId, version, relativePath, contentBase64 },
        { timeout: 120000 }
    )
    return result?.data || result
}

//MARKETPLACE IMPORT

export async function importAssistantSkillsFromRepo(repoUrl, ref, jobId) {
    const result = await runHttpsCallableFunction(
        'importAssistantSkillsFromRepo',
        { repoUrl, ref: ref || null, jobId: jobId || null },
        { timeout: 300000 }
    )
    return result?.data || result
}

// Live progress of a running import (doc written server-side while the
// callable works). Callback receives null until the first server write lands.
export function watchSkillImportJob(jobId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`assistantSkillImportJobs/${jobId}`)
        .onSnapshot(doc => {
            callback(doc.exists ? doc.data() : null)
        })
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
