import { useSelector } from 'react-redux'

export default function useActiveDragMode(projectId) {
    const activeDragSkillModeId = useSelector(state => state.activeDragSkillModeId)
    const activeDragMode = activeDragSkillModeId === projectId
    return activeDragMode
}
