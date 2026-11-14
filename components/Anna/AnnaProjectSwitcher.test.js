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

it('shows Automatic as the start and lets the default project be picked on its own (AT-3024)', () => {
    const automatic = { ...choices[0], id: ':automatic', name: '', isDefault: false, isAutomatic: true }
    const onSelect = jest.fn()
    render({ choices: [automatic, ...choices], activeProjectId: ':automatic', onSelect })
    expect(chip().textContent).toBe('Automatic')
    expect(chip().getAttribute('aria-label')).toBe('Project: Automatic')
    // "Automatic" is not a project: its project data is never requested.
    expect(useProjectsData).toHaveBeenLastCalledWith(['home', 'product', 'team'], 'assistants', { enabled: false })
    act(() => chip().click())
    expect(options().map(option => option.textContent)).toEqual([
        'AutomaticAnna · Automatic project description',
        'HomeAnna · Default project',
        'Alldone ProductAlldone CTO · Visible to project members',
        'Alldone TeamAnna (default assistant)',
    ])
    expect(container.querySelector('[aria-selected="true"]').textContent).toContain('Automatic')
    act(() => options()[1].click())
    expect(onSelect).toHaveBeenCalledWith('home')
})

// AT-3034: the same choice, offered as "who answers" at the top left of the sidebar.
describe('assistant variant', () => {
    const automatic = { ...choices[0], id: ':automatic', name: '', isDefault: false, isAutomatic: true }
    const all = [automatic, ...choices]
    const trigger = () => container.querySelector('.anna-assistant-picker')

    it('names the answering assistant and lists assistants, not every project', () => {
        const onSelect = jest.fn()
        render({ variant: 'assistant', choices: all, activeProjectId: ':automatic', onSelect })
        expect(chip()).toBeNull()
        expect(trigger().getAttribute('aria-label')).toBe('Assistant: Anna')
        expect(trigger().title).toBe('Assistant: Anna – Choose assistant for this chat')
        // Who has an assistant of their own is only known once every project's assistants load.
        expect(useProjectsData).toHaveBeenLastCalledWith(['home', 'product', 'team'], 'assistants', { enabled: false })
        act(() => trigger().click())
        expect(useProjectsData).toHaveBeenLastCalledWith(['home', 'product', 'team'], 'assistants', { enabled: true })
        expect(mockPopoverProps.position).toEqual(['bottom', 'top'])
        expect(container.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe(
            'Choose assistant for this chat'
        )
        expect(options().map(option => option.textContent)).toEqual([
            'AnnaAutomatic project description',
            'Alldone CTOAlldone Product · Visible to project members',
        ])
        act(() => options()[1].click())
        expect(onSelect).toHaveBeenCalledWith('product')
    })

    it('keeps the active project listed even when the default assistant answers there', () => {
        render({ variant: 'assistant', choices: all, activeProjectId: 'team' })
        act(() => trigger().click())
        expect(options().map(option => option.textContent)).toEqual([
            'AnnaAutomatic project description',
            'Alldone CTOAlldone Product · Visible to project members',
            'AnnaAlldone Team',
        ])
        expect(container.querySelector('[aria-selected="true"]').textContent).toBe('AnnaAlldone Team')
    })

    it('lists the default project itself when there is no "Automatic" entry', () => {
        render({ variant: 'assistant', activeProjectId: 'product' })
        act(() => trigger().click())
        expect(options().map(option => option.textContent)).toEqual([
            'AnnaHome · Default project',
            'Alldone CTOAlldone Product · Visible to project members',
        ])
    })

    // AT-3047: the whole name opens the picker, not only the small chevron beside it.
    it('makes the name and the chevron one button that opens the picker', () => {
        const onSelect = jest.fn()
        render({ variant: 'assistant', choices: all, activeProjectId: ':automatic', onSelect, name: 'Anna Alldone' })
        const button = trigger()
        expect(container.querySelectorAll('button')).toHaveLength(1)
        expect(button.type).toBe('button')
        expect(button.querySelector('.anna-brand').textContent).toBe('Anna Alldone')
        expect(button.querySelector('.anna-assistant-picker-chevron').getAttribute('aria-hidden')).toBe('true')
        expect(button.querySelector('button, a, input, select, [tabindex]')).toBeNull()
        // The accessible name contains the visible name; the title keeps the full, untruncated name.
        expect(button.getAttribute('aria-label')).toBe('Assistant: Anna Alldone')
        expect(button.title).toBe('Assistant: Anna Alldone – Choose assistant for this chat')
        expect(button.getAttribute('aria-haspopup')).toBe('dialog')
        expect(button.getAttribute('aria-expanded')).toBe('false')
        // A press on the name toggles exactly once (no second handler on the name).
        act(() => button.querySelector('.anna-brand').click())
        expect(button.getAttribute('aria-expanded')).toBe('true')
        expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual(['show'])
        act(() => button.querySelector('.anna-brand').click())
        expect(button.getAttribute('aria-expanded')).toBe('false')
        expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual(['show', 'hide'])
        act(() => button.click())
        act(() => options()[1].click())
        expect(onSelect).toHaveBeenCalledWith('product')
    })

    it('keeps the name readable while the picker is unavailable', () => {
        render({ variant: 'assistant', choices: all, activeProjectId: ':automatic', disabled: true, name: 'Anna' })
        expect(trigger().disabled).toBe(true)
        expect(trigger().querySelector('.anna-brand').textContent).toBe('Anna')
        act(() => trigger().querySelector('.anna-brand').click())
        expect(trigger().getAttribute('aria-expanded')).toBe('false')
    })

    it('is hidden with a single project and disabled during a call', () => {
        render({ variant: 'assistant', choices: [choices[0]] })
        expect(trigger()).toBeNull()
        render({ variant: 'assistant', choices: all, activeProjectId: ':automatic', disabled: true })
        expect(trigger().disabled).toBe(true)
        expect(trigger().title).toBe('Finish the call and stay online to change the assistant')
    })
})
