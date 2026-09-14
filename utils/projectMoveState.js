export const SUPPORTED_PROJECT_MOVE_TYPES = ['task', 'note', 'goal', 'contact', 'chat', 'skill']

export const isProjectMovePending = object =>
    !!object?.movingToOtherProjectId || object?.projectMove?.status === 'moving'
