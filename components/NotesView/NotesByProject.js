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

export default class NotesByProject extends PureComponent {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            notes: {},
            stickyNotes: [],
            filteredNotes: {},
            filteredStickyNotes: [],
            pressedShowMore: false,
            needShowMoreButton: false,
            hashtagFilters: Array.from(storeState.hashtagFilters.keys()),
            unsubscribe: store.subscribe(this.updateState),
        }

        this.dismissibleRefs = {}
        this.datesForNotes = {}
        this.stickyCounter = 0
        this.notesCounter = 0
    }

    componentDidMount() {
        this.updateLastAddNewNoteDate()
        this.watchUserNotes(false, true)
        this.watchNotesNeedShowMoreButton()
    }

    componentDidUpdate(prevProps, prevState) {
        const { pressedShowMore, notes, stickyNotes, hashtagFilters } = this.state
        const { filterBy } = this.props

        if (prevProps.filterBy !== filterBy) {
            this.datesForNotes = {}
            this.stickyCounter = 0
            this.notesCounter = 0
            this.setState({ notes: {}, stickyNotes: [] })
            this.watchUserNotes(pressedShowMore, true)
            this.watchNotesNeedShowMoreButton()
        }

        if (hashtagFilters.length > 0) {
            if (!isEqual(prevState.hashtagFilters, hashtagFilters) || !isEqual(prevState.notes, notes)) {
                this.filterNotes()
            }
            if (!isEqual(prevState.hashtagFilters, hashtagFilters) || !isEqual(prevState.stickyNotes, stickyNotes)) {
                this.filterStickyNotes()
            }
        } else {
            this.setState({ filteredNotes: notes })
            this.setState({ filteredStickyNotes: stickyNotes })
        }
    }

    componentWillUnmount() {
        this.unwatchUserNotes()
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()
        this.setState({
            hashtagFilters: Array.from(storeState.hashtagFilters.keys()),
        })
    }

    setNeedShowMoreButton = amountOfNotes => {
        const { maxNotesToRender } = this.props
        this.setState({ needShowMoreButton: amountOfNotes > maxNotesToRender })
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
        setTimeout(() => {
            store.dispatch(startLoadingData())
        })
        const { project, filterBy, setLastEditNoteDate, maxNotesToRender } = this.props
        const { selectedProjectIndex } = store.getState()
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

        let lastEditedDate = 0
        this.notesCounter = 0

        const updateNotes = changes => {
            this.setState(state => {
                const notes = { ...state.notes }
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
                    setLastEditNoteDate(lastEditedDate)
                }

                store.dispatch(stopLoadingData())
                store.dispatch(setNotesAmounts(this.notesCounter + this.stickyCounter, project.index))

                return { notes }
            })
        }

        const updateStickyNotes = changes => {
            this.setState(state => {
                let stickyNotes = [...state.stickyNotes]
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

                store.dispatch(setNotesAmounts(this.notesCounter + this.stickyCounter, project.index))
                return { stickyNotes }
            })
        }

        if (inAllProjects) {
            if (filterBy === ALL_TAB) {
                pressedShowMore
                    ? Backend.watchAllTabNotesExpandedInAllProjects(project.id, updateNotes)
                    : Backend.watchAllTabNotesInAllProjects(project.id, maxNotesToRender, updateNotes)
            } else {
                pressedShowMore
                    ? Backend.watchFollowedTabNotesExpandedInAllProjects(project.id, updateNotes)
                    : Backend.watchFollowedTabNotesInAllProjects(project.id, maxNotesToRender, updateNotes)
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

    filterNotes = () => {
        const { notes } = this.state
        this.setState({ filteredNotes: filterNotes(notes) })
    }

    filterStickyNotes = () => {
        const { stickyNotes } = this.state
        this.setState({ filteredStickyNotes: filterStickyNotes(stickyNotes) })
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
        this.setState({ pressedShowMore: true })
        this.watchUserNotes(true, false)
    }

    render() {
        const { selectedProjectIndex } = store.getState()
        const { project } = this.props

        const { filteredNotes, filteredStickyNotes, pressedShowMore, needShowMoreButton } = this.state

        const notesArr = Object.entries(filteredNotes).sort((a, b) => b[0] - a[0])

        const todayDate = moment()
        const todayDateKey = todayDate.format('YYYYMMDD')
        const todayNotes = filteredNotes[todayDateKey] ? filteredNotes[todayDateKey] : []

        const notesAmount = calcNotesAmountByProjectIndex(project.index)
        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

        const showShowMoreButton = needShowMoreButton && notesAmount > 0

        return (
            <View style={{ marginBottom: inAllProjects ? 25 : 32 }}>
                <ProjectHeader projectIndex={project.index} projectId={project.id} />
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
                {showShowMoreButton && (
                    <ShowMoreButton
                        expanded={pressedShowMore}
                        contract={this.contractShowMore}
                        expand={this.expandShowMore}
                    />
                )}
            </View>
        )
    }
}
