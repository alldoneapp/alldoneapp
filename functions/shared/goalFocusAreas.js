'use strict'

const MAX_FOCUS_AREA_NAME_LENGTH = 60

const normalizeFocusAreaName = value =>
    typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''

const focusAreaNameKey = value => normalizeFocusAreaName(value).toLowerCase()

const getProjectFocusAreas = catalog =>
    Object.entries(catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {})
        .map(([id, area]) => ({ id, name: normalizeFocusAreaName(area?.name) }))
        .filter(area => area.name && focusAreaNameKey(area.name) !== 'general')
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))

const getGoalFocusArea = (goal, catalog) => {
    const id = goal?.focusAreaId
    if (typeof id !== 'string' || !id || !Object.prototype.hasOwnProperty.call(catalog || {}, id)) return null
    const name = normalizeFocusAreaName(catalog[id]?.name)
    return name && focusAreaNameKey(name) !== 'general' ? { id, name } : null
}

// Input ordering is already the milestone's manual ordering. Only partition it;
// never sort the goals themselves or insert empty catalog entries into the board.
const groupGoalsByFocusArea = (goals, catalog) => {
    const areas = getProjectFocusAreas(catalog)
    const buckets = new Map(areas.map(area => [area.id, { ...area, goals: [] }]))
    const general = { id: '', name: 'General', goals: [] }
    goals.forEach(goal => (buckets.get(goal.focusAreaId) || general).goals.push(goal))
    const groups = [...buckets.values()].filter(group => group.goals.length)
    if (general.goals.length) groups.push(general)
    return groups
}

const invalidFocusArea = code => {
    const error = new Error(code)
    error.code = code
    return error
}

const validateFocusAreaName = value => {
    const name = normalizeFocusAreaName(value)
    if (!name || name.length > MAX_FOCUS_AREA_NAME_LENGTH) throw invalidFocusArea('focus-area-invalid-name')
    if (focusAreaNameKey(name) === 'general') throw invalidFocusArea('focus-area-reserved-name')
    return name
}

// A project transaction makes simultaneous, differently capitalized creations
// converge on one ID, while preserving other members' catalog changes.
const ensureProjectFocusArea = async (db, projectId, value, newId) => {
    const name = validateFocusAreaName(value)
    const projectRef = db.doc(`projects/${projectId}`)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(projectRef)
        if (!snapshot.exists) throw invalidFocusArea('focus-area-project-not-found')
        const project = snapshot.data()
        const existing = getProjectFocusAreas(project.focusAreas).find(
            area => focusAreaNameKey(area.name) === focusAreaNameKey(name)
        )
        if (existing) return existing
        transaction.update(projectRef, { [`focusAreas.${newId}`]: { name } })
        return { id: newId, name }
    })
}

const renameProjectFocusArea = async (db, projectId, areaId, value) => {
    const name = validateFocusAreaName(value)
    const projectRef = db.doc(`projects/${projectId}`)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(projectRef)
        const areas = getProjectFocusAreas(snapshot.data()?.focusAreas)
        if (!areas.some(area => area.id === areaId)) throw invalidFocusArea('focus-area-not-found')
        if (areas.some(area => area.id !== areaId && focusAreaNameKey(area.name) === focusAreaNameKey(name))) {
            throw invalidFocusArea('focus-area-duplicate-name')
        }
        transaction.update(projectRef, { [`focusAreas.${areaId}.name`]: name })
        return { id: areaId, name }
    })
}

const resolveFocusAreaForProjectMove = async (db, sourceProject, targetProjectId, goal, newId) => {
    const area = getGoalFocusArea(goal, sourceProject?.focusAreas)
    if (!area) return null
    return (await ensureProjectFocusArea(db, targetProjectId, area.name, newId)).id
}

module.exports = {
    MAX_FOCUS_AREA_NAME_LENGTH,
    normalizeFocusAreaName,
    focusAreaNameKey,
    getProjectFocusAreas,
    getGoalFocusArea,
    groupGoalsByFocusArea,
    ensureProjectFocusArea,
    renameProjectFocusArea,
    resolveFocusAreaForProjectMove,
}
