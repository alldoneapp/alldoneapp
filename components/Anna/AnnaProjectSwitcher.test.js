import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaProjectSwitcher, { ANNA_PROJECT_SEARCH_THRESHOLD } from './AnnaProjectSwitcher'
import { useProjectsData } from '../../hooks/useProjectData'

const mockDispatch = jest.fn()
let mockEscape = null
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))
jest.mock('../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'show' }),
    hideFloatPopup: () => ({ type: 'hide' }),
}))
jest.mock('../../hooks/useProjectData', () => ({ useProjectsData: jest.fn() }))
jest.mock('../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../hooks/useEscapeKey', () => (callback, { enabled }) => {
    mockEscape = enabled ? callback : null
})
jest.mock('../Icon', () => () => null)
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/%\{(\w+)\}/g, (_, key) => values[key]),
}))
let mockPopoverProps
jest.mock('../UIComponents/ModalShell/AppPopover', () => props => {
    mockPopoverProps = props
    return (
        <>
            {props.children}
            {props.isOpen && props.content}
        </>
    )
})

const anna = { uid: 'anna', displayName: 'Anna' }
const cto = { uid: 'cto', displayName: 'Alldone CTO' }
const choices = [
    { id: 'home', name: 'Home', isDefault: true, assistant: anna, isShared: false },
    { id: 'product', name: 'Alldone Product', assistant: cto, isProjectAssistant: true, isShared: true },
    { id: 'team', name: 'Alldone Team', assistant: anna, isProjectAssistant: false, isShared: false },
]
let root, container
const render = props =>
    act(() => root.render(<AnnaProjectSwitcher choices={choices} activeProjectId="home" {...props} />))
const chip = () => container.querySelector('.anna-project-chip')
const options = () => [...container.querySelectorAll('.anna-project-option')]

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('shows the active project and lists who answers in each project', () => {
    const onSelect = jest.fn()
    render({ onSelect })
    expect(chip().textContent).toBe('Home')
    expect(chip().getAttribute('aria-label')).toBe('Project: Home')
    expect(useProjectsData).toHaveBeenLastCalledWith(['home', 'product', 'team'], 'assistants', { enabled: false })
    act(() => chip().click())
    expect(useProjectsData).toHaveBeenLastCalledWith(['home', 'product', 'team'], 'assistants', { enabled: true })
    expect(mockPopoverProps).toMatchObject({ isOpen: true, useSheet: false })
    expect(options().map(option => option.textContent)).toEqual([
        'HomeAnna · Default project',
        'Alldone ProductAlldone CTO · Visible to project members',
        'Alldone TeamAnna (default assistant)',
    ])
    expect(container.querySelector('[aria-selected="true"]').textContent).toContain('Home')
    act(() => options()[1].click())
    expect(onSelect).toHaveBeenCalledWith('product')
    expect(options()).toEqual([])
    expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual(['show', 'hide'])
})

it('does nothing when the active project is picked again, and closes on Escape', () => {
    const onSelect = jest.fn()
    render({ onSelect })
    act(() => chip().click())
    act(() => options()[0].click())
    expect(onSelect).not.toHaveBeenCalled()
    act(() => chip().click())
    act(() => mockEscape())
    expect(options()).toEqual([])
})

it('cannot be opened during a call, dictation or offline, and closes when that starts', () => {
    render({ onSelect: jest.fn() })
    act(() => chip().click())
    render({ onSelect: jest.fn(), disabled: true })
    expect(options()).toEqual([])
    expect(chip().disabled).toBe(true)
})

it('renders nothing when there is no other project to switch to', () => {
    render({ choices: [choices[0]] })
    expect(chip()).toBeNull()
})

it('filters a long list and picks the first match on Enter', () => {
    const many = Array.from({ length: ANNA_PROJECT_SEARCH_THRESHOLD }, (_, index) => ({
        id: `p${index}`,
        name: `Project ${index}`,
        assistant: anna,
        isDefault: index === 0,
    }))
    many[5] = { ...many[5], name: 'Alldone Product', assistant: cto, isProjectAssistant: true }
    const onSelect = jest.fn()
    render({ choices: many, activeProjectId: 'p0', onSelect })
    act(() => chip().click())
    const search = container.querySelector('.anna-project-search')
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'cto')
        search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(options().map(option => option.textContent)).toEqual(['Alldone ProductAlldone CTO'])
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith('p5')
})
