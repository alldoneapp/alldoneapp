import React, { PureComponent } from 'react'
import { View } from 'react-native'
import Backend from '../../utils/BackendBridge'
import moment from 'moment'
import store from '../../redux/store'
import NotesByDate from './NotesByDate'
import { setLastAddNewNoteDate, setNotesAmounts, stopLoadingData, startLoadingData } from '../../redux/actions'
import { calcNotesAmountByProjectIndex, sortNotesFn } from './NotesHelper'
import { checkIfSelectedAllProjects, checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import ShowMoreButton from '../UIControls/ShowMoreButton'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import NotesSticky from './NotesSticky'
import { isEqual } from 'lodash'
import { filterNotes, filterStickyNotes } from '../HashtagFilters/FilterHelpers/FilterNotes'
import NotesHeader from './NotesHeader'
import NoteMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Notes/NoteMoreButton'
import NoteOwnerFiltersLine from './NoteFilters/NoteOwnerFiltersLine'
import { filterNotesByOwner, filterStickyNotesByOwner } from './NoteFilters/noteOwnerFilterHelper'
import { getNoteFilterStateUpdate } from './noteFilterSubscription'
import NotesListSkeleton from './NotesListSkeleton'
import { resolveGhostRowCount } from '../UIComponents/Ghosts/ghostRowCount'
import {
    buildSecondaryViewCacheKey,
    getSecondaryViewCacheEntry,
    getSecondaryViewCacheEntrySync,
    SECONDARY_VIEW_NOTES,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'

export const getNotesViewCacheKey = ({ projectId, filterBy, maxNotesToRender, inAllProjects }) =>
    buildSecondaryViewCacheKey(projectId, filterBy, maxNotesToRender, inAllProjects ? 'all-projects' : 'project')

export const limitNotesForViewCache = (notes, maxNotesToRender) => {
    const limited = {}
    let remaining = Math.max(0, maxNotesToRender)
    Object.keys(notes || {})
        .sort((a, b) => b - a)
        .some(date => {
            if (remaining <= 0) return true
            const rows = Array.isArray(notes[date]) ? notes[date].slice(0, remaining) : []
            if (rows.length > 0) limited[date] = rows
            remaining -= rows.length
            return remaining <= 0
        })
    return limited
}

export default class NotesByProject extends PureComponent {
    constructor(props) {
        super(props)
        const storeState = store.getState()
        const inAllProjects = checkIfSelectedAllProjects(storeState.selectedProjectIndex)
        const cacheKey = getNotesViewCacheKey({
            projectId: props.project.id,
            filterBy: props.filterBy,
            maxNotesToRender: props.maxNotesToRender,
            inAllProjects,
        })
        const cachedSnapshot = getSecondaryViewCacheEntrySync(storeState.loggedUser.uid, SECONDARY_VIEW_NOTES, cacheKey)
        const cachedSnapshotIsValid =
            cachedSnapshot?.projectId === props.project.id &&
            cachedSnapshot.filterBy === props.filterBy &&
            cachedSnapshot.inAllProjects === inAllProjects
        const notes = cachedSnapshotIsValid ? cachedSnapshot.notes || {} : {}
        const stickyNotes = cachedSnapshotIsValid ? cachedSnapshot.stickyNotes || [] : []
        const hashtagFilters = Array.from(storeState.hashtagFilters.keys())
        const noteOwnerFilters = storeState.noteOwnerFilters
        const hashtagFilteredNotes = hashtagFilters.length > 0 ? filterNotes(notes) : notes
        const hashtagFilteredStickyNotes = hashtagFilters.length > 0 ? filterStickyNotes(stickyNotes) : stickyNotes

        this.state = {
            notes,
            stickyNotes,
            filteredNotes: filterNotesByOwner(hashtagFilteredNotes, noteOwnerFilters),
            filteredStickyNotes: filterStickyNotesByOwner(hashtagFilteredStickyNotes, noteOwnerFilters),
            hashtagFilteredNotes,
            hashtagFilteredStickyNotes,
            pressedShowMore: false,
            initialLoading: !cachedSnapshotIsValid && props.showInitialSkeleton === true,
            // AT-2382 - drives the note-shaped ghosts under the list while an expansion is
            // in flight. It stays local because the global loading refcount represents the
            // page-level wait, while these ghosts represent one specific list expansion.
            loadingMoreNotes: false,
            needShowMoreButton: cachedSnapshotIsValid ? !!cachedSnapshot.needShowMoreButton : false,
            hashtagFilters,
            noteOwnerFilters,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.dismissibleRefs = {}
        this.datesForNotes = {}
        Object.entries(notes).forEach(([date, rows]) => {
            rows.forEach(note => {
                this.datesForNotes[note.id] = date
            })
        })
        this.stickyCounter = stickyNotes.length
        this.notesCounter = Object.values(notes).reduce((total, rows) => total + rows.length, 0)
        this.finishTrackedLoading = null
        this.cacheKey = cacheKey
        this.cachedSnapshot = cachedSnapshotIsValid ? cachedSnapshot : null
        this.cacheApplied = cachedSnapshotIsValid
        this.liveNotesSnapshotDelivered = false
        this.liveStickySnapshotDelivered = false
        this.mounted = false
    }

    componentDidMount() {
        this.mounted = true
        if (this.cachedSnapshot) this.publishCachedSnapshot(this.cachedSnapshot)
        this.loadPersistedSnapshot()
        this.updateLastAddNewNoteDate()
        this.watchUserNotes(false, true)
        this.watchNotesNeedShowMoreButton()
    }

    componentDidUpdate(prevProps, prevState) {
        const { pressedShowMore, notes, stickyNotes, hashtagFilters, noteOwnerFilters } = this.state
        const { filterBy, maxNotesToRender, project } = this.props

        const filterChanged = prevProps.filterBy !== filterBy
        const maxNotesChanged = prevProps.maxNotesToRender !== maxNotesToRender
        const projectIdChanged = prevProps.project.id !== project.id

        if (filterChanged || maxNotesChanged || projectIdChanged) {
            this.persistViewSnapshot(prevProps, prevState)
            this.datesForNotes = {}
            this.stickyCounter = 0
            this.notesCounter = 0
            this.cacheApplied = false
            const { loggedUser, selectedProjectIndex } = store.getState()
            const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
            this.cacheKey = getNotesViewCacheKey({
                projectId: project.id,
                filterBy,
                maxNotesToRender,
                inAllProjects,
            })
            const cachedSnapshot = getSecondaryViewCacheEntrySync(loggedUser.uid, SECONDARY_VIEW_NOTES, this.cacheKey)
            if (!this.applyCachedSnapshot(cachedSnapshot)) {
                this.setState({
                    notes: {},
                    stickyNotes: [],
                    filteredNotes: {},
                    filteredStickyNotes: [],
                    hashtagFilteredNotes: {},
                    hashtagFilteredStickyNotes: [],
                    loadingMoreNotes: false,
                    initialLoading: this.props.showInitialSkeleton === true,
                })
            }
            this.loadPersistedSnapshot()
            this.watchUserNotes(pressedShowMore, true)
            this.watchNotesNeedShowMoreButton()
        }

        // `updateState` runs on every store dispatch, so this comparison is hot. The notes
        // watchers always hand setState a freshly built object/array, so identity is a
        // sufficient (and much cheaper) change signal than a deep compare of the whole map.
        // The filter arrays do need a value compare: hashtagFilters is rebuilt from the
        // store's Map on each dispatch and would otherwise look changed every time.
        const filtersChanged =
            !isEqual(prevState.hashtagFilters, hashtagFilters) || !isEqual(prevState.noteOwnerFilters, noteOwnerFilters)

        if (filtersChanged || prevState.notes !== notes) {
            this.filterNotes()
        }
        if (filtersChanged || prevState.stickyNotes !== stickyNotes) {
            this.filterStickyNotes()
        }
    }

    componentWillUnmount() {
        this.mounted = false
        this.persistViewSnapshot()
        this.finishTrackedLoading?.()
        this.unwatchUserNotes()
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()
        this.setState(state => getNoteFilterStateUpdate(state, storeState))
    }

    publishCachedSnapshot = snapshot => {
        const { project, onInitialSnapshot, setLastEditNoteDate } = this.props
        const notes = snapshot?.notes || {}
        const lastEditedDate = Object.values(notes)
            .flat()
            .reduce((latest, note) => Math.max(latest, note?.lastEditionDate || 0), 0)
        if (setLastEditNoteDate) setLastEditNoteDate(project, lastEditedDate)
        store.dispatch(setNotesAmounts(this.notesCounter + this.stickyCounter, project.index))
        onInitialSnapshot?.(project.id)
    }

    applyCachedSnapshot = snapshot => {
        const { project, filterBy } = this.props
        const { selectedProjectIndex, hashtagFilters, noteOwnerFilters } = store.getState()
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        if (
            !snapshot ||
            snapshot.projectId !== project.id ||
            snapshot.filterBy !== filterBy ||
            snapshot.inAllProjects !== inAllProjects ||
            !snapshot.notes ||
            !Array.isArray(snapshot.stickyNotes)
        ) {
            return false
        }

        const notes = snapshot.notes
        const stickyNotes = snapshot.stickyNotes
        const filtersArray = Array.from(hashtagFilters.keys())
        const hashtagFilteredNotes = filtersArray.length > 0 ? filterNotes(notes) : notes
        const hashtagFilteredStickyNotes = filtersArray.length > 0 ? filterStickyNotes(stickyNotes) : stickyNotes
        this.datesForNotes = {}
        Object.entries(notes).forEach(([date, rows]) => {
            rows.forEach(note => {
                this.datesForNotes[note.id] = date
            })
        })
        this.notesCounter = Object.values(notes).reduce((total, rows) => total + rows.length, 0)
        this.stickyCounter = stickyNotes.length
        this.cacheApplied = true
        this.cachedSnapshot = snapshot
        this.setState(
            {
                notes,
                stickyNotes,
                hashtagFilteredNotes,
                hashtagFilteredStickyNotes,
                filteredNotes: filterNotesByOwner(hashtagFilteredNotes, noteOwnerFilters),
                filteredStickyNotes: filterStickyNotesByOwner(hashtagFilteredStickyNotes, noteOwnerFilters),
                initialLoading: false,
                needShowMoreButton: !!snapshot.needShowMoreButton,
            },
            () => this.publishCachedSnapshot(snapshot)
        )
        return true
    }

    loadPersistedSnapshot = () => {
        const { loggedUser } = store.getState()
        getSecondaryViewCacheEntry(loggedUser.uid, SECONDARY_VIEW_NOTES, this.cacheKey).then(snapshot => {
            // Either listener makes part of the current state newer than the stored projection.
            // Mixing that live half with a late full-cache restore could resurrect stale rows.
            if (
                !this.mounted ||
                this.liveNotesSnapshotDelivered ||
                this.liveStickySnapshotDelivered ||
                this.cacheApplied
            ) {
                return
            }
            this.applyCachedSnapshot(snapshot)
        })
    }

    persistViewSnapshot = (props = this.props, state = this.state) => {
        // Do not replace a persisted projection with the constructor's empty state while the
        // IndexedDB read and the main notes listener are still racing on first mount.
        if (!this.cacheApplied && !this.liveNotesSnapshotDelivered) return
        const { loggedUser, selectedProjectIndex } = store.getState()
        const { project, filterBy, maxNotesToRender } = props
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        const cacheKey = getNotesViewCacheKey({
            projectId: project.id,
            filterBy,
            maxNotesToRender,
            inAllProjects,
        })
        this.cacheKey = cacheKey
        setSecondaryViewCacheEntry(loggedUser.uid, SECONDARY_VIEW_NOTES, cacheKey, {
            projectId: project.id,
            filterBy,
            inAllProjects,
            notes: limitNotesForViewCache(state.notes, maxNotesToRender),
            stickyNotes: inAllProjects ? [] : state.stickyNotes.slice(0, maxNotesToRender),
            needShowMoreButton: state.needShowMoreButton,
        })
    }

    setNeedShowMoreButton = amountOfNotes => {
        const { maxNotesToRender } = this.props
        this.setState({ needShowMoreButton: amountOfNotes > maxNotesToRender }, this.persistViewSnapshot)
    }

    watchNotesNeedShowMoreButton = () => {
        const { project, filterBy, maxNotesToRender } = this.props
        const { selectedProjectIndex } = store.getState()
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        const notesToLoad = maxNotesToRender + 1
        if (inAllProjects) {
            filterBy === ALL_TAB
                ? Backend.watchAllTabNotesNeedShowMoreInAllProjects(project.id, notesToLoad, this.setNeedShowMoreButton)
                : Backend.watchFollowedTabNotesNeedShowMoreInAllProjects(
                      project.id,
                      notesToLoad,
                      this.setNeedShowMoreButton
                  )
        } else {
            filterBy === ALL_TAB
                ? Backend.watchAllTabNotesNeedShowMore(project.id, notesToLoad, this.setNeedShowMoreButton)
                : Backend.watchFollowedTabNotesNeedShowMore(project.id, notesToLoad, this.setNeedShowMoreButton)
        }
    }

    watchUserNotes = (pressedShowMore, watchStickyNotes) => {
        this.finishTrackedLoading?.()
        this.finishTrackedLoading = null

        const { project, filterBy, setLastEditNoteDate, maxNotesToRender, onInitialSnapshot } = this.props
        const { selectedProjectIndex } = store.getState()
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        const trackInitialLoad = (this.props.trackInitialLoad !== false && !this.cacheApplied) || pressedShowMore
        if (trackInitialLoad) {
            store.dispatch(startLoadingData())
            let loadingActive = true
            this.finishTrackedLoading = () => {
                if (!loadingActive) return
                loadingActive = false
                store.dispatch(stopLoadingData())
            }
        }

        let lastEditedDate = 0
        let initialSnapshotDelivered = false
        this.liveNotesSnapshotDelivered = false
        if (watchStickyNotes) this.liveStickySnapshotDelivered = false

        const updateNotes = changes => {
            const replaceExistingSnapshot = !this.liveNotesSnapshotDelivered
            this.liveNotesSnapshotDelivered = true
            this.cacheApplied = false
            if (replaceExistingSnapshot) {
                this.datesForNotes = {}
                this.notesCounter = 0
            }
            // Compute state updates first; schedule side-effects in setState callback
            let finalLastEditedDate = 0
            this.setState(
                state => {
                    const notes = replaceExistingSnapshot ? {} : { ...state.notes }
                    const datesToSort = new Set()
                    let lastEditedDateRemoved = false

                    for (let change of changes) {
                        const noteId = change.doc.id
                        const type = change.type
                        const noteAdded = type === 'added'
                        const noteModified = type === 'modified'

                        const note = Backend.mapNoteData(noteId, change.doc.data())
                        const editedTimestamp = note.lastEditionDate
                        const date = moment(editedTimestamp).format('YYYYMMDD')

                        const addNote = () => {
                            if (!notes[date]) notes[date] = []
                            notes[date] = notes[date].concat(note)
                            this.datesForNotes[noteId] = date
                            if (notes[date].length > 1) datesToSort.add(date)
                        }

                        const deleteDate = date => {
                            if (notes[date].length <= 1) {
                                if (notes[date].length === 0) delete notes[date]
                                datesToSort.delete(date)
                            }
                        }

                        if (noteModified) {
                            const oldDate = this.datesForNotes[noteId]
                            notes[oldDate] = notes[oldDate].filter(noteItem => noteItem.id !== noteId)
                            if (oldDate !== date) deleteDate(oldDate)
                            if (inAllProjects && lastEditedDate < editedTimestamp) lastEditedDate = editedTimestamp
                            addNote()
                        } else if (noteAdded) {
                            this.notesCounter++
                            if (inAllProjects && lastEditedDate < editedTimestamp) lastEditedDate = editedTimestamp
                            if (!this.datesForNotes[noteId]) addNote()
                        } else {
                            this.notesCounter--
                            notes[date] = notes[date].filter(noteItem => noteItem.id !== noteId)
                            delete this.datesForNotes[noteId]
                            deleteDate(date)
                            if (inAllProjects && lastEditedDate === editedTimestamp) {
                                lastEditedDateRemoved = true
                            }
                        }
                    }

                    for (let date of datesToSort) {
                        notes[date].sort(sortNotesFn)
                    }

                    if (inAllProjects) {
                        if (this.notesCounter === 0) {
                            lastEditedDate = moment('01-01-1970', 'DD-MM-YYYY').valueOf()
                        } else if (lastEditedDateRemoved) {
                            const notesList = Object.values(notes).flat()
                            notesList.sort(sortNotesFn)
                            lastEditedDate = notesList[0].lastEditionDate
                        }
                        finalLastEditedDate = lastEditedDate
                    }

                    // AT-2382 - the ghosts are retired by the same state update that puts the
                    // real rows in, so there is never a frame with both (or with neither).
                    return { notes, loadingMoreNotes: false, initialLoading: false }
                },
                () => {
                    // Side-effects moved out of updater to avoid React warning about updates inside update functions
                    if (inAllProjects) {
                        setLastEditNoteDate(project, finalLastEditedDate)
                    }
                    this.finishTrackedLoading?.()
                    this.finishTrackedLoading = null
                    if (!initialSnapshotDelivered) {
                        initialSnapshotDelivered = true
                        onInitialSnapshot?.(project.id)
                    }
                    store.dispatch(setNotesAmounts(this.notesCounter + this.stickyCounter, project.index))
                    this.persistViewSnapshot()
                    // Debug: validate side-effects run post state update
                    console.debug(
                        '[NotesByProject] post-setState(updateNotes): dispatched setNotesAmounts and stopLoadingData'
                    )
                }
            )
        }

        const updateStickyNotes = changes => {
            const replaceExistingSnapshot = !this.liveStickySnapshotDelivered
            this.liveStickySnapshotDelivered = true
            if (replaceExistingSnapshot) this.stickyCounter = 0
            this.setState(
                state => {
                    let stickyNotes = replaceExistingSnapshot ? [] : [...state.stickyNotes]
                    let needToSortNotes = false

                    for (let change of changes) {
                        const noteId = change.doc.id
                        const type = change.type
                        const noteAdded = type === 'added'
                        const noteModified = type === 'modified'

                        const note = Backend.mapNoteData(noteId, change.doc.data())

                        if (noteModified) {
                            for (let i = 0; i < stickyNotes.length; i++) {
                                const noteItem = stickyNotes[i]
                                if (noteItem.id === noteId) {
                                    stickyNotes[i] = note
                                    if (stickyNotes.length > 1) needToSortNotes = true
                                    break
                                }
                            }
                        } else if (noteAdded) {
                            this.stickyCounter++
                            stickyNotes.push(note)
                            if (stickyNotes.length > 1) needToSortNotes = true
                        } else {
                            this.stickyCounter--
                            stickyNotes = stickyNotes.filter(noteItem => noteItem.id !== noteId)
                            if (stickyNotes.length <= 1) needToSortNotes = false
                        }
                    }

                    if (needToSortNotes) {
                        stickyNotes.sort(sortNotesFn)
                    }

                    return { stickyNotes }
                },
                () => {
                    store.dispatch(setNotesAmounts(this.notesCounter + this.stickyCounter, project.index))
                    this.persistViewSnapshot()
                    // Debug: validate side-effects run post state update
                    console.debug('[NotesByProject] post-setState(updateStickyNotes): dispatched setNotesAmounts')
                }
            )
        }

        if (inAllProjects) {
            const watcherOptions = { trackConnectionHealth: trackInitialLoad }
            if (filterBy === ALL_TAB) {
                pressedShowMore
                    ? Backend.watchAllTabNotesExpandedInAllProjects(project.id, updateNotes, watcherOptions)
                    : Backend.watchAllTabNotesInAllProjects(project.id, maxNotesToRender, updateNotes, watcherOptions)
            } else {
                pressedShowMore
                    ? Backend.watchFollowedTabNotesExpandedInAllProjects(project.id, updateNotes, watcherOptions)
                    : Backend.watchFollowedTabNotesInAllProjects(
                          project.id,
                          maxNotesToRender,
                          updateNotes,
                          watcherOptions
                      )
            }
        } else {
            if (filterBy === ALL_TAB) {
                pressedShowMore
                    ? Backend.watchAllTabNotesExpanded(project.id, updateNotes)
                    : Backend.watchAllTabNotes(project.id, maxNotesToRender, updateNotes)
                if (watchStickyNotes) {
                    Backend.watchAllTabStickyNotes(project.id, updateStickyNotes)
                }
            } else {
                pressedShowMore
                    ? Backend.watchFollowedTabNotesExpanded(project.id, updateNotes)
                    : Backend.watchFollowedTabNotes(project.id, maxNotesToRender, updateNotes)
                if (watchStickyNotes) {
                    Backend.watchFollowedTabStickyNotes(project.id, updateStickyNotes)
                }
            }
        }
    }

    // Hashtag filters and the owner filter compose: a note has to satisfy both. Each helper
    // returns the original reference when its filter is inactive, so with no filters at all
    // `filteredNotes` stays reference-equal to `notes` and the PureComponent does not churn.
    // The intermediate hashtag-only result is kept so the owner chips can count what the
    // hashtag filter left on screen without collapsing to the owner already selected.
    filterNotes = () => {
        const { notes, hashtagFilters, noteOwnerFilters } = this.state
        const byHashtag = hashtagFilters.length > 0 ? filterNotes(notes) : notes
        this.setState({
            hashtagFilteredNotes: byHashtag,
            filteredNotes: filterNotesByOwner(byHashtag, noteOwnerFilters),
        })
    }

    filterStickyNotes = () => {
        const { stickyNotes, hashtagFilters, noteOwnerFilters } = this.state
        const byHashtag = hashtagFilters.length > 0 ? filterStickyNotes(stickyNotes) : stickyNotes
        this.setState({
            hashtagFilteredStickyNotes: byHashtag,
            filteredStickyNotes: filterStickyNotesByOwner(byHashtag, noteOwnerFilters),
        })
    }

    unwatchUserNotes = () => {
        const { project } = this.props
        Backend.unwatchNotes2(project.id)
        Backend.unwatchStickyNotes(project.id)
        Backend.unwatchNotesNeedShowMore(project.id)
    }

    updateLastAddNewNoteDate = () => {
        const { selectedProjectIndex } = store.getState()
        const { firstProject, project } = this.props
        if (checkIfSelectedProject(selectedProjectIndex) || firstProject) {
            store.dispatch(setLastAddNewNoteDate({ projectId: project.id, date: null }))
        }
    }

    cleanNotesWhenContract = () => {
        const { maxNotesToRender } = this.props

        this.setState(state => {
            const { notes } = state
            const dates = Object.keys(notes)
            dates.sort((a, b) => b - a)
            let count = 0
            const cleanedNotes = {}
            this.datesForNotes = {}

            const updateDatesForNotes = (cleanedNotes, date) => {
                for (let note of cleanedNotes[date]) {
                    this.datesForNotes[note.id] = date
                }
            }

            for (let date of dates) {
                cleanedNotes[date] = notes[date]
                count += notes[date].length
                if (count >= maxNotesToRender) {
                    const lastIndexToKeep = notes[date].length + maxNotesToRender - count
                    cleanedNotes[date] = cleanedNotes[date].slice(0, lastIndexToKeep)
                    updateDatesForNotes(cleanedNotes, date)
                    break
                }
                updateDatesForNotes(cleanedNotes, date)
            }
            return { pressedShowMore: false, notes: cleanedNotes }
        })
    }

    contractShowMore = () => {
        this.cleanNotesWhenContract()
        this.watchUserNotes(false, false)
    }

    expandShowMore = () => {
        // Guarded because the expanded watcher is unbounded and re-entrant: a second press
        // while the first snapshot is still buffered would tear the listener down and start
        // the wait over, with the ghosts already on screen making it look like progress.
        if (this.state.loadingMoreNotes) return
        this.setState({ pressedShowMore: true, loadingMoreNotes: true })
        this.watchUserNotes(true, false)
    }

    render() {
        const { selectedProjectIndex, currentUser } = store.getState()
        const { maxNotesToRender, project } = this.props

        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        if (this.state.initialLoading) {
            return (
                <View style={{ marginBottom: inAllProjects ? 25 : 32 }}>
                    <NotesListSkeleton rowCount={resolveGhostRowCount(maxNotesToRender)} showProjectHeader />
                </View>
            )
        }

        const {
            filteredNotes,
            filteredStickyNotes,
            hashtagFilteredNotes,
            hashtagFilteredStickyNotes,
            pressedShowMore,
            needShowMoreButton,
            loadingMoreNotes,
        } = this.state

        const notesArr = Object.entries(filteredNotes).sort((a, b) => b[0] - a[0])

        const todayDate = moment()
        const todayDateKey = todayDate.format('YYYYMMDD')
        const todayNotes = filteredNotes[todayDateKey] ? filteredNotes[todayDateKey] : []

        const notesAmount = calcNotesAmountByProjectIndex(project.index)
        const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

        const showShowMoreButton = needShowMoreButton && notesAmount > 0

        return (
            <View style={{ marginBottom: inAllProjects ? 25 : 32 }}>
                <ProjectHeader
                    projectIndex={project.index}
                    projectId={project.id}
                    customRight={
                        inSelectedProject ? (
                            <NoteMoreButton
                                projectId={project.id}
                                user={currentUser}
                                wrapperStyle={localStyles.moreButtonWrapper}
                                buttonStyle={localStyles.moreButton}
                                iconSize={16}
                            />
                        ) : null
                    }
                    showRootSectionNavigation={inSelectedProject}
                />
                {inSelectedProject && <NotesHeader />}
                {inSelectedProject && (
                    <NoteOwnerFiltersLine
                        projectId={project.id}
                        notes={hashtagFilteredNotes}
                        stickyNotes={hashtagFilteredStickyNotes}
                    />
                )}
                <NotesSticky
                    fStickyNotes={filteredStickyNotes}
                    inAllProjects={inAllProjects}
                    dismissibleRefs={this.dismissibleRefs}
                    project={project}
                />
                <NotesByDate notes={todayNotes} project={project} dateString={'TODAY'} date={todayDate} />
                {notesArr.map((entry, index) => {
                    const noteList = entry[1]
                    const dateKey = entry[0]
                    const isNotToday = todayDateKey !== dateKey
                    if (isNotToday) {
                        const isFirstDateSection = index === 0
                        const timestamp = moment(noteList[0].lastEditionDate)
                        const dateString = timestamp.format(getDateFormat())
                        return (
                            <NotesByDate
                                key={dateKey}
                                notes={noteList}
                                project={project}
                                dateString={dateString}
                                date={timestamp}
                                firstDateSection={isFirstDateSection}
                            />
                        )
                    }
                })}
                {loadingMoreNotes && <NotesListSkeleton rowCount={resolveGhostRowCount(this.props.maxNotesToRender)} />}
                {showShowMoreButton && (
                    <ShowMoreButton
                        expanded={pressedShowMore}
                        contract={this.contractShowMore}
                        expand={this.expandShowMore}
                        loading={loadingMoreNotes}
                    />
                )}
            </View>
        )
    }
}

const localStyles = {
    moreButtonWrapper: {
        marginTop: 3,
        marginLeft: 2,
    },
    moreButton: {
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
    },
}
