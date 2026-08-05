import React from 'react'
import renderer from 'react-test-renderer'

import ProjectModalItem from '../../../components/UIComponents/FloatModals/SelectProjectModal/ProjectModalItem'

// The row no longer writes the choice into the store through setProject, nor
// calls Backend.setTaskProject itself - it reports the selection upwards via
// onProjectSelect and lets the caller decide. It also takes no task any more.
const project = { id: 'id0', name: 'Running out of cool names', color: '#0055ff' }
const newProject = { id: 'id1', name: 'Fotuto', color: '#FF0000' }

const render = (props = {}) =>
    renderer.create(
        <ProjectModalItem project={project} newProject={newProject} onProjectSelect={() => {}} {...props} />
    )

describe('ProjectModalItem component', () => {
    it('should render correctly', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('renders differently once it is the active row', () => {
        expect(render({ active: true }).toJSON()).toMatchSnapshot()
    })

    it('reports the selected project to its caller', () => {
        const onProjectSelect = jest.fn()
        const tree = render({ onProjectSelect })

        const [pressable] = tree.root.findAll(node => typeof node.props.onPress === 'function')
        const event = {}
        pressable.props.onPress(event)

        expect(onProjectSelect).toHaveBeenCalledWith(event, project, newProject)
    })
})
