import momentTz from 'moment-timezone'
import moment from 'moment-timezone'

import store from '../../redux/store'
import { fetchUserDataResult, updateUserDataDirectly } from '../backends/Users/usersFirestore'
import {
    initFCMonLoad,
    initGoogleTagManager,
    proccessAssistantDialyTopicIfNeeded,
    resetTimesDoneInExpectedDayPropertyInTasksIfNeeded,
    unwatch,
    updateLastLoggedUserDate,
    watchForceReload,
} from '../backends/firestore'
import {
    initLogInForLoggedUser,
    setDoneMilestonesInProjectInTasks,
    setGoalsInProjectInTasks,
    setOpenMilestonesInProjectInTasks,
    setOpenSubtasksMap,
    setOpenTasksMap,
    setProjectsInitialData,
    updateFilteredOpenTasks,
    updateLoadingStep,
    updateOpenTasks,
    updateSubtaskByTask,
    updateThereAreHiddenNotMainTasks,
    updateThereAreNotTasksInFirstDay,
} from '../../redux/actions'
import { getProgressLoadingMessage } from '../FunnyLoadingMessages'
import { isBrowserOffline } from '../connectionState'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import { getDeviceLanguage } from '../../i18n/TranslationService'
import {
    convertAnonymousProjectsIntoSharedProjects,
    getInitialProjectData,
    handleCookies,
    loadGlobalData,
    unwatchProjectsData,
    watchLoggedUserData,
    watchProjectData,
    watchProjectsChatNotifications,
} from './initialLoadHelper'
import { getProjectDataResult } from '../backends/firestore'
import { storeVersion } from '../Observers'
import { checkIfUrlBelongsToProjectInTheList } from '../LinkingHelper'
import { resolveBootCriticalProjectIds } from './projectDataPriority'
import { ensureProjectDataLoaded, forgetAllProjectData, PROJECT_DATA_ASSISTANTS } from './projectDataLoader'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../NavigationService'
import UserDataCache from '../UserDataCache'
import {
    haveSameProjectIds,
    isCompleteProjectsInitialData,
    sanitizeProjectsInitialData,
} from './projectsInitialDataHelper'
import { getMissingProjectEntriesIds, pruneStaleProjectIds } from './staleProjectSelfHeal'
import { scheduleBootIntegrityChecks } from './bootIntegrityHealer'
import { isEqual } from 'lodash'
import { trackEvent } from '../analytics/analytics'
import { scheduleAfterInitialTaskData } from './startupTaskReadiness'
import { getRestorableTaskColdStartSnapshot, readTaskColdStartCache } from './taskColdStartCache'
import { markNamedPerformanceTrace } from '../performance/performanceLogger'

// A valid local user snapshot is enough to construct the project list. Give an
// authoritative read a small chance to win (preserving the zero-staleness fast
// path), then continue it in the background instead of holding the loading
// screen on a multi-second Firestore read.
export const CACHED_USER_REFRESH_BOOT_BUDGET_MS = 250
// The default assistant makes the All Projects assistant line richer, but it is not required to
// route or paint task rows. Give a cached snapshot one short chance to win; keep the watcher alive
// in the background when it does not. Project deep links still await their complete route bundle.
export const DEFAULT_ASSISTANT_BOOT_BUDGET_MS = 250
export const CACHED_PROJECT_REFRESH_SETTLE_MS = 10000
export const CACHED_PROJECT_REFRESH_FALLBACK_MS = 30000
export const POST_LOGIN_MAINTENANCE_SETTLE_MS = 6000
export const POST_LOGIN_MAINTENANCE_FALLBACK_MS = 20000
export const TASK_COLD_START_RESTORE_BUDGET_MS = 250
const CACHED_USER_REFRESH_BUDGET_ELAPSED = Symbol('cached-user-refresh-budget-elapsed')
let cancelDeferredProjectWatchers = null
let cancelDeferredCachedProjectRefresh = null
let cancelDeferredLoginMaintenance = null

const waitWithinBudget = (promise, budgetMs) =>
    new Promise(resolve => {
        let settled = false
        let timer
        const finish = value => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
        }
        timer = setTimeout(() => finish(false), budgetMs)
        Promise.resolve(promise).then(finish, () => finish(false))
    })

function watchProjectsData(projectIds) {
    // Stagger watcher initialization to reduce initial Firebase load
    const ids = Array.isArray(projectIds) ? projectIds : []
    ids.forEach((projectId, index) => {
        setTimeout(() => {
            watchProjectData(projectId, true, false)
        }, index * 50) // 50ms delay between each watcher
    })
}

async function getInitialProjectsData(projectIds) {
    // Check if we have cached project data first.
    // NOTE: never sort the caller's arrays in place here - `projectIds` is the live
    // `loggedUser.projectIds` array from the redux state.
    const cachedData = UserDataCache.getCachedGlobalData()
    if (cachedData && cachedData.projectIds && haveSameProjectIds(cachedData.projectIds, projectIds)) {
        if (isCompleteProjectsInitialData(cachedData.projectsInitialData, cachedData.projectIds.length)) {
            if (__DEV__) console.log('Using cached project data for faster startup')

            // A heavy account can have more than one hundred historical project memberships.
            // Refreshing every project document at a fixed two-second delay starved the task
            // listeners on Firestore's IndexedDB queue precisely while the first rows were being
            // discovered. The cached project shell is already complete, so refresh it only after
            // the task board has painted and received a generous quiet window.
            if (cancelDeferredCachedProjectRefresh) cancelDeferredCachedProjectRefresh()
            const scheduledUserId = store.getState().loggedUser?.uid
            cancelDeferredCachedProjectRefresh = scheduleAfterInitialTaskData(
                async () => {
                    cancelDeferredCachedProjectRefresh = null
                    if (store.getState().loggedUser?.uid !== scheduledUserId) return
                    try {
                        const freshData = await loadProjectsDataFromFirebase(projectIds)
                        if (!isCompleteProjectsInitialData(freshData, projectIds.length)) {
                            // A partially failed load must never overwrite a good cache: the bad
                            // payload would be replayed on every startup for the next 24h.
                            console.warn('[InitialLoad] Background project refresh incomplete, keeping previous cache')
                            return
                        }
                        if (!isEqual(freshData, cachedData.projectsInitialData)) {
                            UserDataCache.setCachedGlobalData({ projectsInitialData: freshData, projectIds })
                        }
                    } catch (error) {
                        console.warn('Error refreshing project data:', error)
                    }
                },
                {
                    fallbackMs: CACHED_PROJECT_REFRESH_FALLBACK_MS,
                    settleMs: CACHED_PROJECT_REFRESH_SETTLE_MS,
                }
            )

            return cachedData.projectsInitialData
        }

        console.warn(
            '[InitialLoad] Cached project data is malformed or incomplete, reloading from Firebase',
            sanitizeProjectsInitialData(cachedData.projectsInitialData, cachedData.projectIds, null).invalidEntries
        )
    }

    // Load from Firebase and only cache a payload that is actually complete.
    const projectsInitialData = await loadProjectsDataFromFirebase(projectIds)
    if (isCompleteProjectsInitialData(projectsInitialData, projectIds.length)) {
        UserDataCache.setCachedGlobalData({ projectsInitialData, projectIds })
    } else {
        console.warn('[InitialLoad] Project data incomplete, not caching it for the next startup')
    }

    return projectsInitialData
}

async function loadProjectsDataFromFirebase(projectIds, retryCount = 0) {
    const MAX_RETRIES = 5
    const RETRY_DELAY_MS = 5000

    // AT-2386: only the project DOCUMENT is loaded here. Its four per-project collections
    // (users, contacts, workstreams, assistants) used to be awaited in this same `Promise.all`
    // for every project - 56 collection reads on the reporting account, 523 contact documents
    // among them - before login could finish. They are now loaded by `projectDataLoader`:
    // awaited for the priority projects and pulled on demand by whatever renders the rest.
    // `sanitizeProjectsInitialData` normalizes the absent
    // fields to `[]`, which is the invariant the unguarded consumers rely on.
    const allPromises = projectIds.map(projectId =>
        getProjectDataResult(projectId)
            .then(projectResult => {
                const { project, missingFromCache } = projectResult
                if (!project) {
                    if (missingFromCache) {
                        // The "missing" answer came from the local cache because the backend was
                        // unreachable — the project may well exist on the server (seen in
                        // production 2026-08-13: three live projects read as missing during one
                        // degraded load). Treat it exactly like a failed read: a null entry, so
                        // it is retried when everything failed and recovered by the live project
                        // watchers otherwise — never labeled deleted, never a self-heal candidate.
                        console.warn(
                            `[InitialLoad] Project ${projectId} could not be read (backend unreachable), treating it as a failed read`
                        )
                        return null
                    }
                    // The server confirmed the document is gone (deleted project, revoked
                    // membership, stale cached projectIds). Keep the entry so the caller can
                    // report it, but never let it reach the redux mapping step.
                    console.warn(
                        `[InitialLoad] Project ${projectId} has no data (deleted or not accessible), skipping it`
                    )
                }
                return { projectId, project }
            })
            .catch(error => {
                console.error(`Failed to load project ${projectId}:`, error)
                return null
            })
    )

    const results = await Promise.all(allPromises)
    // Only a failed READ (null entry) is worth retrying. A project whose document is simply gone
    // resolves to `{ project: null }` and would never come back, so it must not trigger retries.
    const loadedCount = results.filter(result => result !== null).length

    // If all projects failed and we have retries left, wait and try again
    if (loadedCount === 0 && projectIds.length > 0 && retryCount < MAX_RETRIES) {
        // Offline, retrying cannot succeed (whatever the Firestore cache holds has
        // already answered) — return what we have instead of burning 25s of delays.
        // The live project watchers and the boot integrity checks recover the rest
        // once connectivity returns.
        if (isBrowserOffline()) {
            console.warn('[InitialLoad] Browser is offline - not retrying project loads')
            return results
        }
        console.log(
            `All projects failed to load. Retrying in ${RETRY_DELAY_MS / 1000}s... (attempt ${
                retryCount + 1
            }/${MAX_RETRIES})`
        )
        store.dispatch(updateLoadingStep(3, 'Waiting for internet connection...'))
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        return loadProjectsDataFromFirebase(projectIds, retryCount + 1)
    }

    // Self-heal: ids whose read succeeded but whose project doc is gone keep re-arming a
    // boot-time race on every cold load (see staleProjectSelfHeal.js). Fire-and-forget so the
    // login flow is never delayed or failed by it.
    pruneStaleProjectIds(getMissingProjectEntriesIds(results)).catch(error =>
        console.warn('[InitialLoad] Stale project id self-heal failed:', error)
    )

    return results
}

/**
 * The URL login is about to route to. Extracted so `loadInitialData` can prioritise that project's
 * data and `loadInitialDataForLoggedUser` can route with it - reading `window.location.pathname`
 * in one place and `initialUrl` in the other would prioritise a different project than the one the
 * user actually lands on.
 */
function getInitialRoutingUrl() {
    const { initialUrl } = store.getState()
    return initialUrl && initialUrl !== '/' ? initialUrl : window.location.pathname
}

async function loadInitialData() {
    const { loggedUser } = store.getState()
    const projectIds = Array.isArray(loggedUser.projectIds) ? loggedUser.projectIds : []
    // Start this read alongside the project shell. It uses a separate, tiny IndexedDB database, so
    // a healthy cache is normally ready before the project list; a bounded wait below prevents a
    // damaged browser database from ever extending the login path.
    markNamedPerformanceTrace('app_boot', 'task_cache_read_started')
    const cachedTaskSnapshotPromise = readTaskColdStartCache(loggedUser.uid)
    store.dispatch(updateLoadingStep(3, getProgressLoadingMessage()))
    const projectsInitialData = await getInitialProjectsData(projectIds)

    // Process the raw project data into organized structures.
    // Drop everything that is not a fully loaded project (failed reads, deleted projects,
    // malformed cache entries): a single bad entry must never abort the whole login.
    const { validEntries, invalidEntries } = sanitizeProjectsInitialData(projectsInitialData, projectIds)

    if (invalidEntries.length > 0 && validEntries.length === 0 && projectIds.length > 0) {
        console.error('[InitialLoad] No project could be loaded, continuing login with an empty project list')
    }

    const projects = []
    const projectsMap = {}
    const projectUsers = {}
    const projectContacts = {}
    const projectWorkstreams = {}
    const projectAssistants = {}

    // AT-2386: since `loadProjectsDataFromFirebase` stopped fetching the four per-project
    // collections, `sanitizeProjectsInitialData` normalizes them to `[]` here. That empty seed is
    // load-bearing, not incidental: ~a dozen consumers read `projectUsers[projectId].length`,
    // `projectContacts[projectId].map(...)` and friends WITHOUT a guard, so the key must exist for
    // every project from the first frame. Only the content is deferred.
    validEntries.forEach(({ project, users, contacts, workstreams, assistants }) => {
        projects.push(project)
        projectsMap[project.id] = project
        projectUsers[project.id] = users
        projectContacts[project.id] = contacts
        projectWorkstreams[project.id] = workstreams
        projectAssistants[project.id] = assistants
    })

    convertAnonymousProjectsIntoSharedProjects(
        projects,
        projectsMap,
        projectUsers,
        projectContacts,
        projectWorkstreams,
        projectAssistants
    )

    unwatchProjectsData(projectIds)
    // The watchers above are gone, so the loader must forget that it ever armed them - otherwise a
    // re-login (or an anonymous -> logged transition) would consider every project already loaded
    // and never re-arm anything.
    forgetAllProjectData()

    store.dispatch(updateLoadingStep(4, getProgressLoadingMessage()))
    store.dispatch(
        setProjectsInitialData(
            projects,
            projectsMap,
            projectUsers,
            projectWorkstreams,
            projectContacts,
            projectAssistants
        )
    )

    const cachedTaskSnapshot = await waitWithinBudget(cachedTaskSnapshotPromise, TASK_COLD_START_RESTORE_BUDGET_MS)
    const restorableTaskSnapshot = getRestorableTaskColdStartSnapshot(
        cachedTaskSnapshot,
        loggedUser.uid,
        projects.map(project => project.id)
    )
    markNamedPerformanceTrace('app_boot', 'task_cache_read_finished', {
        outcome: restorableTaskSnapshot ? 'hit' : 'miss_or_budget',
    })
    if (restorableTaskSnapshot) {
        const hydrationActions = []
        Object.entries(restorableTaskSnapshot.projects).forEach(([projectId, projectSnapshot]) => {
            const instanceKey = `${projectId}${loggedUser.uid}`
            hydrationActions.push(
                updateOpenTasks(instanceKey, projectSnapshot.openTasks),
                // Filters are empty on a fresh Redux store. OpenTasksByProjectHandler reapplies
                // any live filters in a layout effect before paint on same-session restores.
                updateFilteredOpenTasks(instanceKey, projectSnapshot.openTasks),
                updateSubtaskByTask(instanceKey, projectSnapshot.subtaskByTask || {}),
                setOpenTasksMap(projectId, projectSnapshot.openTasksMap || {}),
                setOpenSubtasksMap(projectId, projectSnapshot.openSubtasksMap || {}),
                ...(Array.isArray(projectSnapshot.openMilestones)
                    ? [setOpenMilestonesInProjectInTasks(projectId, projectSnapshot.openMilestones)]
                    : []),
                ...(Array.isArray(projectSnapshot.doneMilestones)
                    ? [setDoneMilestonesInProjectInTasks(projectId, projectSnapshot.doneMilestones)]
                    : []),
                ...(projectSnapshot.goalsById && typeof projectSnapshot.goalsById === 'object'
                    ? [setGoalsInProjectInTasks(projectId, projectSnapshot.goalsById)]
                    : []),
                updateThereAreNotTasksInFirstDay(instanceKey, !!projectSnapshot.thereAreNotTasksInFirstDay),
                updateThereAreHiddenNotMainTasks(instanceKey, !!projectSnapshot.thereAreHiddenNotMainTasks)
            )
        })
        if (hydrationActions.length > 0) store.dispatch(hydrationActions)
        markNamedPerformanceTrace('app_boot', 'task_cache_restored', {
            project_count: Object.keys(restorableTaskSnapshot.projects).length,
        })
    }

    watchLoggedUserData(loggedUser)

    // AT-2386: the per-project collections start here instead of inside the login bundle. Await
    // only the exact data that initial URL routing reads synchronously:
    //
    // - a route project needs its complete bundle because a project URL can resolve a user,
    //   contact, workstream or assistant from redux;
    // - the default project needs only assistants for `getDefaultAssistant`; on All Projects this
    //   gets a short cache budget and then continues behind the task board rather than holding the
    //   route for the full first-snapshot timeout.
    //
    // In-focus/first projects are rendering priorities, not routing dependencies. Their existing
    // lookup funnels request data on demand after the first frame.
    const loadedProjectIds = projects.map(project => project.id)
    const { routeProjectId, defaultAssistantProjectId } = resolveBootCriticalProjectIds({
        urlProjectId: checkIfUrlBelongsToProjectInTheList(getInitialRoutingUrl(), loadedProjectIds),
        loggedUser,
        projectIds: loadedProjectIds,
    })

    const bootCriticalLoads = []
    if (routeProjectId) bootCriticalLoads.push(ensureProjectDataLoaded(routeProjectId))
    if (defaultAssistantProjectId && defaultAssistantProjectId !== routeProjectId) {
        const defaultAssistantLoad = ensureProjectDataLoaded(defaultAssistantProjectId, PROJECT_DATA_ASSISTANTS)
        bootCriticalLoads.push(
            routeProjectId
                ? defaultAssistantLoad
                : waitWithinBudget(defaultAssistantLoad, DEFAULT_ASSISTANT_BOOT_BUDGET_MS)
        )
    }

    // Each load is bounded inside the loader, so a wedged stream delays routing by at most one
    // snapshot budget instead of hanging it.
    await Promise.all(bootCriticalLoads)

    // Project-document and chat-notification listeners are important for the live session but
    // irrelevant to painting the first task rows. Fourteen active projects used to add all of
    // those listeners only 200ms after routing, right in the task-query window.
    if (cancelDeferredProjectWatchers) cancelDeferredProjectWatchers()
    cancelDeferredProjectWatchers = scheduleAfterInitialTaskData(() => {
        if (store.getState().loggedUser?.uid !== loggedUser.uid) return
        try {
            watchProjectsData(projectIds)
            watchProjectsChatNotifications()
        } catch (error) {
            console.warn('[InitialLoad] Failed to start project watchers:', error)
        }
        scheduleBootIntegrityChecks()
    })

    // A degraded boot can leave projects (and the administrator user) out of redux for the whole
    // session — the wedged streams never deliver, so the watcher-based recovery never triggers.
    // These checks re-fetch what is missing and, if needed, rebuild the Firestore connection.
    // They are armed with the project watchers above so the first 1s integrity probe cannot get
    // ahead of the task queries on a healthy boot.

    store.dispatch(updateLoadingStep(5, getProgressLoadingMessage()))
}

const getDataForUpdateUser = async loggedUser => {
    const userData = {}

    if (!loggedUser.dateFormat) {
        const { dateFormat, mondayFirstInCalendar } = await getDateFormatFromCurrentLocation()
        userData.dateFormat = dateFormat
        userData.mondayFirstInCalendar = mondayFirstInCalendar
    }

    if (!loggedUser.language) userData.language = getDeviceLanguage()

    const isFirstLoginInDay = !moment().isSame(moment(loggedUser.firstLoginDateInDay), 'day')
    if (isFirstLoginInDay) {
        const dateNow = moment().valueOf()
        userData.firstLoginDateInDay = dateNow
        userData.activeTaskStartingDate = dateNow
        userData.activeTaskInitialEndingDate = dateNow
        userData.activeTaskId = ''
        userData.activeTaskProjectId = ''
    }

    userData.timezone = parseInt(momentTz().format('Z'))
    userData.preferredTimezone = momentTz.tz.guess()
    userData.lastLogin = Date.now()

    return userData
}

export async function loadInitialDataForLoggedUser(loggedUser) {
    unwatch('loggedUser')

    store.dispatch(updateLoadingStep(1, getProgressLoadingMessage()))

    initGoogleTagManager(loggedUser.uid)
    trackEvent('login', { method: 'google' })
    watchForceReload(loggedUser.uid, true)
    storeVersion()

    ProjectHelper.processInactiveProjectsWhenLoginUser(loggedUser)

    const userData = await getDataForUpdateUser(loggedUser)

    // No premium check on login. It discarded its result — premium.status is read from the user
    // document, written by the Stripe webhook and reconciled by dailyPremiumStatusCheck — so this
    // only cost a callable per login and surfaced its failures in the console. The signup flow
    // still calls it directly, where the result is actually used (tracking-ID linking and the
    // premium initial-gold grant).

    store.dispatch(initLogInForLoggedUser({ ...loggedUser, ...userData }))

    // Use updateUserDataDirectly to avoid updating lastEditionDate on every login
    // (which would cause the user to jump to the top of the contact list)
    updateUserDataDirectly(loggedUser.uid, userData, null)

    store.dispatch(updateLoadingStep(2, getProgressLoadingMessage()))
    await loadInitialData()

    if (cancelDeferredLoginMaintenance) cancelDeferredLoginMaintenance()
    cancelDeferredLoginMaintenance = scheduleAfterInitialTaskData(
        () => {
            cancelDeferredLoginMaintenance = null
            if (store.getState().loggedUser?.uid !== loggedUser.uid) return
            try {
                initFCMonLoad()
            } catch (e) {
                console.warn('initFCMonLoad failed:', e)
            }
            Promise.resolve()
                .then(() => updateLastLoggedUserDate())
                .catch(e => console.warn('updateLastLoggedUserDate failed:', e))
            // Disabled daily recap - will be replaced with recurring assistant task
            // proccessAssistantDialyTopicIfNeeded()
            resetTimesDoneInExpectedDayPropertyInTasksIfNeeded().catch(e =>
                console.warn('resetTimesDoneInExpectedDay failed:', e)
            )
        },
        {
            fallbackMs: POST_LOGIN_MAINTENANCE_FALLBACK_MS,
            settleMs: POST_LOGIN_MAINTENANCE_SETTLE_MS,
        }
    )

    //handleCookies()

    URLTrigger.processUrl(NavigationService, getInitialRoutingUrl())
}

/**
 * Loads the global data and the logged user, reporting WHY there is no user:
 * `{ user, missing, error }`. `missing` is only true when the user document genuinely does not
 * exist - a failed read (offline, transient `permission-denied`) returns `missing: false` plus
 * the error, so the caller can retry instead of treating the account as broken.
 */
export const loadGlobalDataAndGetUserResult = async userId => {
    // Try to load from cache first for faster startup
    const cachedUserData = UserDataCache.getCachedUserData()

    if (cachedUserData && cachedUserData.uid === userId) {
        if (__DEV__) console.log('Using cached user data for faster startup')

        // Global data is optional for completing login and has its own recovery. Start it now,
        // but do not let it delay loading the user's projects.
        loadGlobalData().catch(error => console.warn('Error refreshing global data:', error))

        // Start the authoritative membership refresh immediately. A fast read still wins this
        // boot; a slow read is handed to AppContent so it can reconcile additions through the
        // boot integrity healer after cached projects are already visible.
        const freshResultPromise = fetchUserDataResult(userId, true).then(freshResult => {
            if (freshResult.user && !isEqual(freshResult.user, cachedUserData)) {
                if (__DEV__) console.log('Updating cached user data from the background refresh')
                UserDataCache.setCachedUserData(freshResult.user)
            }
            return freshResult
        })
        let budgetTimer
        const budgetResult = await Promise.race([
            freshResultPromise,
            new Promise(resolve => {
                budgetTimer = setTimeout(
                    () => resolve(CACHED_USER_REFRESH_BUDGET_ELAPSED),
                    CACHED_USER_REFRESH_BOOT_BUDGET_MS
                )
            }),
        ])

        if (budgetResult === CACHED_USER_REFRESH_BUDGET_ELAPSED) {
            return {
                user: cachedUserData,
                missing: false,
                error: null,
                deferredUserResult: freshResultPromise,
            }
        }

        clearTimeout(budgetTimer)
        const freshResult = budgetResult
        if (freshResult.user) {
            return freshResult
        }
        if (freshResult.error) {
            console.warn('Current user data could not be read; using the cached user for this boot.', freshResult.error)
            return { user: cachedUserData, missing: false, error: null }
        }

        // Firestore Lite directly confirmed that the document is gone. Do not let stale local
        // data mask a genuinely inconsistent account.
        return freshResult
    }

    // No cache available, load from Firebase
    const promises = []
    promises.push(fetchUserDataResult(userId, true))
    promises.push(
        // Global data (administrator user, hashtag colors) must not fail the login:
        // offline it can be unreachable while the user document is served from the
        // Firestore cache, and the boot integrity checks re-fetch it once online.
        loadGlobalData().catch(error => console.warn('Error loading global data during login:', error))
    )
    const [{ user, missing, error }] = await Promise.all(promises)

    // Cache the fresh data
    if (user) {
        UserDataCache.setCachedUserData(user)
    }

    return { user, missing, error }
}

export const loadGlobalDataAndGetUser = async userId => {
    const { user } = await loadGlobalDataAndGetUserResult(userId)
    return user
}
