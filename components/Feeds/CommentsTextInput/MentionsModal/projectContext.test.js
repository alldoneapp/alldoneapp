import React from 'react'
import { Platform, StyleSheet, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

Platform.OS = 'web'

const mockState = {
    loggedUser: { uid: 'me' },
    loggedUserProjectsMap: {
        current: { id: 'current', name: 'Current project', color: '#7c66ff', index: 0 },
        other: { id: 'other', name: 'Other project', index: 1 },
    },
    projectContacts: {},
}

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getPeopleById: () => null },
}))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: () => null,
    isGlobalAssistant: () => false,
    GLOBAL_PROJECT_ID: 'globalProject',
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getUserRoleInProject: () => '',
        getUserCompanyInProject: () => '',
        getUserDescriptionInProject: () => '',
    },
}))
jest.mock('../../../ContactsView/Utils/ContactsHelper', () => ({
    __esModule: true,
    default: { getContactPhotoURL: () => '' },
}))
jest.mock('../../../UIControls/SocialText/SocialText', () => ({
    __esModule: true,
    default: require('react-native').Text,
}))
jest.mock('../../TextParser/ObjectHeaderParser', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return { __esModule: true, default: ({ text }) => React.createElement(Text, null, text) }
})

const MentionsItemsGrouped = require('./MentionsItemsGrouped').default
const MentionsContactsGrouped = require('./MentionsContactsGrouped').default
const MentionsGoalsGrouped =
    require('../../../UIComponents/FloatModals/TaskParentGoalModal/MentionsGoalsGrouped').default
const MentionProjectHeader = require('./MentionProjectHeader').default
const ColoredCircleSmall = require('../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall').default
const { MENTION_MODAL_NOTES_TAB, MENTION_MODAL_GOALS_TAB, MENTION_MODAL_CONTACTS_TAB } = require('../textInputHelper')
const { colors } = require('../../../styles/global')

const item = (id, projectId) => ({
    id,
    uid: id,
    title: id,
    extendedTitle: id,
    extendedName: id,
    displayName: id,
    projectId,
    userId: 'me',
    assigneesIds: [],
    progress: 50,
})

const rows = [item('first', 'current'), item('second', 'current'), item('third', 'other')]
const textLeaves = tree => {
    const result = []
    const walk = node => {
        if (typeof node === 'string') result.push(node)
        else if (Array.isArray(node)) node.forEach(walk)
        else node?.children?.forEach(walk)
    }
    walk(tree.toJSON())
    return result
}
const variants = [
    ['notes', MentionsItemsGrouped, MENTION_MODAL_NOTES_TAB],
    ['contacts', MentionsContactsGrouped, MENTION_MODAL_CONTACTS_TAB],
    ['goal picker', MentionsGoalsGrouped, MENTION_MODAL_GOALS_TAB],
]

describe.each(variants)('AT-2759 project context: %s', (name, Component, tab) => {
    const render = (items = rows, activeIndex = 0, select = jest.fn()) => {
        let tree
        act(() => {
            tree = renderer.create(
                <Component
                    currentProjectId="current"
                    items={items}
                    contacts={items}
                    goals={items}
                    activeTab={tab}
                    activeItemIndex={activeIndex}
                    activeUserIndex={activeIndex}
                    selectItemToMention={select}
                    selectUserToMention={select}
                    itemsComponentsRefs={{ current: {} }}
                    usersComponentsRefs={{ current: {} }}
                    currentlyAssignedGoal={rows[0]}
                />
            )
        })
        return tree
    }

    it('labels the current project even when it is the only result group', () => {
        const tree = render(rows.slice(0, 2))
        const headers = tree.root.findAllByType(MentionProjectHeader)
        expect(headers).toHaveLength(1)
        expect(headers[0].props).toMatchObject({ project: mockState.loggedUserProjectsMap.current, amount: 2 })
        expect(textLeaves(tree).indexOf('Current project')).toBeLessThan(textLeaves(tree).indexOf('first'))
        expect(tree.root.findByType(ColoredCircleSmall).props.color).toBe('#7c66ff')
    })

    it('shows each project once with its own count and keeps current-project results first', () => {
        const tree = render([rows[2], rows[0], rows[1]])
        expect(
            tree.root.findAllByType(MentionProjectHeader).map(header => [header.props.project.id, header.props.amount])
        ).toEqual([
            ['current', 2],
            ['other', 1],
        ])
        expect(textLeaves(tree).filter(text => ['first', 'second', 'third'].includes(text))).toEqual([
            'first',
            'second',
            'third',
        ])
    })

    it('shows no empty current-project group for other-project-only results', () => {
        const tree = render([rows[2]])
        expect(textLeaves(tree)).not.toContain('Current project')
        expect(tree.root.findByType(MentionProjectHeader).props.project.id).toBe('other')
        expect(tree.root.findAllByType(ColoredCircleSmall)).toHaveLength(0)
    })

    it('has no headers or selectable rows for an empty result', () => {
        const tree = render([])
        expect(tree.root.findAllByType(MentionProjectHeader)).toHaveLength(0)
        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0)
    })

    it('keeps headers outside the keyboard row indices and preserves selection across groups', () => {
        const select = jest.fn()
        const tree = render(rows, 2, select)
        const buttons = tree.root.findAllByType(TouchableOpacity)
        expect(buttons).toHaveLength(3)
        expect(StyleSheet.flatten(buttons[2].props.style).backgroundColor).toBe(colors.Primary300)
        if (tab === MENTION_MODAL_GOALS_TAB) {
            expect(StyleSheet.flatten(buttons[0].props.style).backgroundColor).toBe(colors.UtilityGreen200)
        }
        act(() => buttons[2].props.onPress())
        expect(select).toHaveBeenCalledWith(rows[2], tab, 'other')
        act(() => buttons[0].props.onPress())
        expect(select).toHaveBeenLastCalledWith(rows[0], tab, 'current')
    })
})
