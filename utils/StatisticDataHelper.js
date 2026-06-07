export const getSafeStatisticNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
        const parsedValue = Number(value.trim())
        return Number.isFinite(parsedValue) ? parsedValue : 0
    }
    return 0
}
