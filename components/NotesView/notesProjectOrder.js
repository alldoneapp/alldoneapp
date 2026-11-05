// AT-2964: All Projects > Notes lists projects by the most recent edit of a note the viewer
// can see, newest first. The board loads project blocks progressively as they approach the
// viewport, so a project's date cannot come from its own block: below the fold that block
// has not loaded yet. Each project is therefore probed once with a one-note query before the
// first block is revealed. These helpers are pure, so the order can be tested without a
// renderer.

// A project with no readable note (or one whose probe never answered) sorts after every
// project that has one, keeping its default position among the rest.
export const NO_NOTE_EDITION_DATE = 0

// Upper bound for holding the board behind its skeleton while the probes run. When it
// passes, the board shows with what is known; live snapshots keep re-sorting loaded projects.
export const PROJECT_ORDER_PROBE_TIMEOUT_MS = 2000

// Guides (projects started from a template) are not listed in All Projects > Notes.
export const isGuideProject = (project, user) =>
    !!project?.parentTemplateId || !!user?.guideProjectIds?.includes(project?.id)

export const excludeGuideProjects = (projects, user) => projects.filter(project => !isGuideProject(project, user))

const editionDateOf = project =>
    typeof project?.lastEditNoteDate === 'number' && Number.isFinite(project.lastEditNoteDate)
        ? project.lastEditNoteDate
        : NO_NOTE_EDITION_DATE

// Newest first. Array.prototype.sort is stable, so ties (above all: projects without notes)
// keep the order they came in, i.e. the user's default project order.
export const sortProjectsByLastNoteEdit = projects => [...projects].sort((a, b) => editionDateOf(b) - editionDateOf(a))

/**
 * Probes every project in parallel and resolves to `{ [projectId]: date }` for the probes
 * that answered with a date. Never rejects: a failed probe and a probe still pending at the
 * timeout are simply absent, so the project keeps its default position.
 */
export const probeProjectsLastNoteEdit = (
    projectIds,
    probe,
    { timeoutMs = PROJECT_ORDER_PROBE_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}
) =>
    new Promise(resolve => {
        const dates = {}
        let pending = projectIds.length
        let settled = false
        let timer = null

        const finish = () => {
            if (settled) return
            settled = true
            if (timer != null) clearTimer(timer)
            resolve({ ...dates })
        }

        if (pending === 0) return finish()
        timer = setTimer(finish, timeoutMs)

        projectIds.forEach(projectId => {
            Promise.resolve()
                .then(() => probe(projectId))
                .then(
                    date => {
                        if (!settled && typeof date === 'number' && Number.isFinite(date)) dates[projectId] = date
                    },
                    () => {}
                )
                .then(() => {
                    pending -= 1
                    if (pending === 0) finish()
                })
        })
    })

// A date already reported by a loaded block is never replaced by an older probe answer.
export const applyProbedEditionDates = (projects, probedDates) =>
    projects.map(project => {
        const probed = probedDates[project.id]
        if (probed == null || probed <= editionDateOf(project)) return project
        return { ...project, lastEditNoteDate: probed }
    })
