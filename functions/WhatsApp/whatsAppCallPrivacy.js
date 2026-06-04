function getSafeCallErrorDetails(error) {
    return {
        name: String(error?.name || 'Error').slice(0, 80),
        code: String(error?.code || '').slice(0, 80),
        status: Number(error?.status) || null,
    }
}

module.exports = { getSafeCallErrorDetails }
