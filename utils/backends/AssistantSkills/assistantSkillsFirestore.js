import { getDb, getId, globalWatcherUnsub, runHttpsCallableFunction } from '../firestore'
import store from '../../../redux/store'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import { BUILT_IN_ASSISTANT_SKILLS, mergeBuiltInAssistantSkills } from '../../AssistantSkills/builtInAssistantSkills'
import { GLOBAL_SKILL_CATALOG_ID as GLOBAL_PROJECT_ID, isGlobalSkillCatalog } from '../../AssistantSkills/skillCatalog'

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

// Re-exported so a caller that already imports this module does not need a
// second import for the predicate that goes with these paths.
export { isGlobalSkillCatalog }

// A skill catalog is keyed by the project that owns it (AT-2450). `globalProject`
// is the administrator-curated catalog every user reads; any other id is that
// project's own skills, readable and writable by its members.
function getSkillsCollectionPath(projectId = GLOBAL_PROJECT_ID) {
    return `assistantSkills/${projectId || GLOBAL_PROJECT_ID}/items`
}

// The built-in skills (task-prioritization) belong to the global catalog only —
// merging them into a project listing would show every project a skill it does
// not own and cannot edit.
function decorateCatalog(skills, projectId) {
    return isGlobalSkillCatalog(projectId) ? mergeBuiltInAssistantSkills(skills) : skills
}

function readSkillDocs(skillDocs) {
    const skills = []
    skillDocs.forEach(doc => {
        const skill = doc.data()
        skill.uid = doc.id
        skills.push(skill)
    })
    return skills
}

export async function getAssistantSkillData(skillId, projectId = GLOBAL_PROJECT_ID) {
    const builtInSkill = BUILT_IN_ASSISTANT_SKILLS.find(skill => skill.uid === skillId || skill.name === skillId)
    if (builtInSkill) return builtInSkill

    const skill = (
        await getDb()
            .doc(`${getSkillsCollectionPath(projectId)}/${skillId}`)
            .get()
    ).data()
    if (skill) skill.uid = skillId
    return skill
}

export async function getGlobalAssistantSkills() {
    return getAssistantSkills(GLOBAL_PROJECT_ID)
}

export async function getAssistantSkills(projectId = GLOBAL_PROJECT_ID) {
    const skillDocs = (
        await getDb().collection(getSkillsCollectionPath(projectId)).orderBy('lastEditionDate', 'desc').get()
    ).docs
    return decorateCatalog(readSkillDocs(skillDocs), projectId)
}

export function watchGlobalAssistantSkills(watcherKey, callback) {
    return watchAssistantSkills(GLOBAL_PROJECT_ID, watcherKey, callback)
}

export function watchAssistantSkills(projectId, watcherKey, callback) {
    let firstSnap = true
    store.dispatch(startLoadingData())
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(getSkillsCollectionPath(projectId))
        .orderBy('lastEditionDate', 'desc')
        .onSnapshot(skillDocs => {
            callback(decorateCatalog(readSkillDocs(skillDocs), projectId))
            if (firstSnap) {
                firstSnap = false
                store.dispatch(stopLoadingData())
            }
        })
}

export async function uploadNewAssistantSkill(skill, projectId = GLOBAL_PROJECT_ID) {
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

    await getDb()
        .doc(`${getSkillsCollectionPath(projectId)}/${skill.uid}`)
        .set(skillToStore)
    return skill
}

export async function updateAssistantSkill(updatedSkill, projectId = GLOBAL_PROJECT_ID) {
    const skillToStore = { ...updatedSkill }
    delete skillToStore.uid
    updateEditionData(skillToStore)
    // `creatorId` is frozen by the security rule on a project skill, so never let
    // a stale copy of it ride along in an update — a client that dropped or
    // rewrote the field would have the whole write rejected.
    delete skillToStore.creatorId
    await getDb()
        .doc(`${getSkillsCollectionPath(projectId)}/${updatedSkill.uid}`)
        .update(skillToStore)
}

export async function deleteAssistantSkill(skillId, projectId = GLOBAL_PROJECT_ID) {
    await getDb()
        .doc(`${getSkillsCollectionPath(projectId)}/${skillId}`)
        .delete()
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
export async function uploadAssistantSkillBundleFile(
    skillId,
    version,
    relativePath,
    contentBase64,
    projectId = GLOBAL_PROJECT_ID
) {
    const result = await runHttpsCallableFunction(
        'uploadAssistantSkillFile',
        { projectId, skillId, version, relativePath, contentBase64 },
        { timeout: 120000 }
    )
    return result?.data || result
}

//MARKETPLACE IMPORT

export async function importAssistantSkillsFromRepo(repoUrl, ref, jobId, projectId = GLOBAL_PROJECT_ID) {
    const result = await runHttpsCallableFunction(
        'importAssistantSkillsFromRepo',
        { projectId, repoUrl, ref: ref || null, jobId: jobId || null },
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

// The administrator's staging area is the flat collection it has always been;
// a project stages under its own path (AT-2450) so that this pending-review
// query stays legal for a non-administrator. See firestore.rules.
function getSkillImportsCollectionPath(projectId) {
    return isGlobalSkillCatalog(projectId) ? 'assistantSkillImports' : `assistantSkillImports/${projectId}/items`
}

export function watchPendingSkillImports(watcherKey, callback, projectId = GLOBAL_PROJECT_ID) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(getSkillImportsCollectionPath(projectId))
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
export async function approveAssistantSkillImport(stagedImport, existingSkills, projectId = GLOBAL_PROJECT_ID) {
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
        await getDb()
            .doc(`${getSkillsCollectionPath(projectId)}/${existing.uid}`)
            .update(skillData)
    } else {
        skillData.version = 1
        skillData.createdDate = Date.now()
        skillData.creatorId = loggedUser.uid
        const skillId = stagedImport.proposedSkillId || getId()
        await getDb()
            .doc(`${getSkillsCollectionPath(projectId)}/${skillId}`)
            .set(skillData)
    }
    await getDb()
        .doc(`${getSkillImportsCollectionPath(projectId)}/${stagedImport.uid}`)
        .update({ status: 'approved' })
}

export async function dismissAssistantSkillImport(importId, projectId = GLOBAL_PROJECT_ID) {
    await getDb()
        .doc(`${getSkillImportsCollectionPath(projectId)}/${importId}`)
        .update({ status: 'dismissed' })
}
