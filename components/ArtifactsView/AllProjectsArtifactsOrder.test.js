import React from 'react'
import renderer, { act } from 'react-test-renderer'

// Each project section is replaced by a probe that reports what the real one would (count and
// newest artifact date) and records how often it mounts, so a reorder that remounts a section — and
// with it the section's Firestore listeners — fails the suite.
const mockReports = {}
const mockMounts = {}
jest.mock('./ProjectArtifacts', () => {
    const { useEffect } = require('react')
    const { View } = require('react-native')
    return function ProjectArtifactsProbe({ project, onLoaded }) {
        useEffect(() => {
            mockMounts[project.id] = (mockMounts[project.id] || 0) + 1
        }, [])
        const report = mockReports[project.id]
        useEffect(() => {
            if (report) onLoaded(project.id, report.count, report.newest)
        }, [report?.count, report?.newest])
        return <View testID={`project-${project.id}`} />
    }
})
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
    checkIfSelectedAllProjects: () => true,
    checkIfSelectedProject: () => false,
}))
jest.mock('../../URLSystem/Artifacts/URLsArtifacts', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../redux/actions', () => ({ setNavigationRoute: jest.fn() }))
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => undefined }))
jest.mock('../Icon', () => () => null)
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

import { AllProjectsArtifacts } from './ArtifactsView'
import { sortProjectsByNewestArtifact, getNewestArtifactDate } from './artifactPresentation'

const T = Date.UTC(2026, 9, 27, 9, 0)
// The base order is the user's own project order (ProjectHelper.sortProjects), as in Notes.
const PROJECTS = [{ id: 'privat' }, { id: 'product' }, { id: 'business' }, { id: 'team' }]

const order = tree =>
    tree.root
        .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('project-'), {
            deep: false,
        })
        .map(node => node.props.testID.replace('project-', ''))

beforeEach(() => {
    Object.keys(mockReports).forEach(key => delete mockReports[key])
    Object.keys(mockMounts).forEach(key => delete mockMounts[key])
})

it('orders the projects by their newest artifact, newest first, like Notes (AT-2887)', async () => {
    Object.assign(mockReports, {
        privat: { count: 2, newest: T - 60 * 60 * 1000 },
        product: { count: 5, newest: T },
        business: { count: 0, newest: 0 },
        team: { count: 1, newest: T - 24 * 60 * 60 * 1000 },
    })
    let tree
    await act(async () => {
        tree = renderer.create(<AllProjectsArtifacts projects={PROJECTS} />)
    })
    expect(order(tree)).toEqual(['product', 'privat', 'team', 'business'])
    // Moved, not remounted: each section (and its listeners) mounted exactly once.
    expect(mockMounts).toEqual({ privat: 1, product: 1, business: 1, team: 1 })
    act(() => tree.unmount())
})

it('keeps the base order for projects whose newest date is unknown or still loading', async () => {
    Object.assign(mockReports, {
        team: { count: 1, newest: T },
        // A legacy sentinel never outranks a real date.
        business: { count: 1, newest: Number.MAX_SAFE_INTEGER },
    })
    let tree
    await act(async () => {
        tree = renderer.create(<AllProjectsArtifacts projects={PROJECTS} />)
    })
    expect(order(tree)).toEqual(['team', 'privat', 'product', 'business'])
    act(() => tree.unmount())
})

describe('ordering helpers', () => {
    it('sorts deterministically and ignores sentinel and malformed dates', () => {
        expect(
            sortProjectsByNewestArtifact(PROJECTS, {
                privat: T,
                product: T,
                business: Number.MAX_SAFE_INTEGER,
                team: 'Invalid date',
            }).map(project => project.id)
        ).toEqual(['privat', 'product', 'business', 'team'])
        expect(sortProjectsByNewestArtifact(PROJECTS).map(project => project.id)).toEqual(
            PROJECTS.map(project => project.id)
        )
    })

    it('finds the newest usable date in an unsorted list', () => {
        expect(
            getNewestArtifactDate([
                { lastEditionDate: Number.MAX_SAFE_INTEGER },
                { lastEditionDate: T - 5 },
                { lastEditionDate: T },
                {},
            ])
        ).toBe(T)
        expect(getNewestArtifactDate([{ lastEditionDate: Number.MAX_SAFE_INTEGER }])).toBe(0)
        expect(getNewestArtifactDate(undefined)).toBe(0)
    })
})
