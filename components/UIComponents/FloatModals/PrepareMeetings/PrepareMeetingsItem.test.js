import React from 'react'
import renderer, { act } from 'react-test-renderer'
import PrepareMeetingsItem from './PrepareMeetingsItem'
import CalendarSectionMoreButton from './CalendarSectionMoreButton'
import { startMeetingPreparation } from '../../../../utils/meetingPreparation'

jest.mock('../../../../utils/meetingPreparation', () => ({ startMeetingPreparation: jest.fn() }))
jest.mock('../MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../MorePopupsOfMainViews/Common/MoreButtonWrapper', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ close: jest.fn() }))
        return React.createElement('MoreButtonWrapper', props, props.children)
    })
})

it('closes the menu, stops propagation and guards rapid clicks before starting a specific briefing', async () => {
    const tasks = [{ id: 'event-1', calendarData: {} }]
    const closeModal = jest.fn()
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
    let finish
    startMeetingPreparation.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    let tree
    act(() => {
        tree = renderer.create(
            <PrepareMeetingsItem
                projectId="project-1"
                tasks={tasks}
                specificTask
                closeModal={closeModal}
                shortcut="2"
            />
        )
    })
    const item = tree.root.findByType('ModalItem')
    let first
    act(() => {
        first = item.props.onPress(event)
    })
    await act(async () => {
        await item.props.onPress(event)
    })
    expect(closeModal).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(startMeetingPreparation).toHaveBeenCalledTimes(1)
    expect(startMeetingPreparation).toHaveBeenCalledWith({ projectId: 'project-1', tasks, specificTask: true })
    await act(async () => {
        finish()
        await first
    })
    act(() => tree.unmount())
})

it('uses the standard heading menu with a section preparation action', () => {
    const tasks = [{ id: 'event-1', calendarData: {} }]
    let tree
    act(() => {
        tree = renderer.create(<CalendarSectionMoreButton projectId="project-1" tasks={tasks} />)
    })
    expect(tree.root.findByType(PrepareMeetingsItem).props).toMatchObject({
        projectId: 'project-1',
        tasks,
        shortcut: '1',
    })
    expect(tree.root.findByType('ModalItem').props.text).toBe('Prepare meetings')
    act(() => tree.unmount())
})
