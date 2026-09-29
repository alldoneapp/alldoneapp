/**
 * Rage mode's three server calls (see functions/RageMode/rageModeProfile.js). The callable funnel is
 * required lazily, on first use: `RageModeButton` sits in the assistant line, and a static import of
 * the Firestore backend would drag the redux store into every suite that renders that line.
 */
const call = (name, data) => {
    const { runHttpsCallableFunction } = require('../../utils/backends/firestore')
    return runHttpsCallableFunction(name, data)
}

export const loadRageProfile = () => call('getRageModeProfile', {})
export const purchaseRageItem = itemId => call('purchaseRageModeItem', { itemId })
export const submitRageScore = score => call('submitRageModeScore', { score })
