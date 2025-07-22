const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function generateGoalObjectModel(currentMilliseconds, goal, goalId) {
    return {
        type: 'goal',
        lastChangeDate: currentMilliseconds,
        goalId: goalId,
        name: goal.extendedName || goal.name,
        isDeleted: false,
        isPublicFor: goal.isPublicFor ? goal.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        lockKey: goal.lockKey ? goal.lockKey : '',
        ownerId: goal.ownerId ? goal.ownerId : '',
    }
}

module.exports = { generateGoalObjectModel }
