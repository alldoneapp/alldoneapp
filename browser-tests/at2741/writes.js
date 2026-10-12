// The real editor/upload pipeline runs, but no production writes are possible.
export const setTaskDescription = async (_projectId, _id, description) => {
    if (window.__failWrite) throw new Error('simulated write failure')
    await new Promise(resolve => setTimeout(resolve, 100))
    window.__writes.push(description)
    window.__setDescription(description)
}
