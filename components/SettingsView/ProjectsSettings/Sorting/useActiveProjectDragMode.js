import { useSelector } from 'react-redux'

export default function useActiveProjectDragMode(projectType) {
    const activeDragProjectModeType = useSelector(state => state.activeDragProjectModeType)
    const activeDragMode = activeDragProjectModeType === projectType
    return activeDragMode
}
