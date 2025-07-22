import React, { useEffect } from 'react'
import { usePrevious } from '../utils/UsePrevious'
import { isEqual } from 'lodash'

const useEffectDebug = (effectHook, dependencies, dependencyNames = [], debug = false) => {
    const previousDeps = usePrevious(dependencies, [])

    const changedDeps = dependencies.reduce((result, dependency, index) => {
        if (!isEqual(dependency, previousDeps[index])) {
            const keyName = dependencyNames[index] || index
            return {
                ...result,
                [keyName]: {
                    before: previousDeps[index],
                    after: dependency,
                },
            }
        }

        return result
    }, {})

    if (debug && Object.keys(changedDeps).length) {
        console.log('[use-effect-debugger] ', changedDeps)
    }

    useEffect(() => effectHook(changedDeps), dependencies)
}

export default useEffectDebug
