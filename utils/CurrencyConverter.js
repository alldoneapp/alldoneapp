// Simple currency converter with approximate exchange rates
// In a production environment, you'd want to use a real-time currency API

const EXCHANGE_RATES = {
    // Base rates (approximate, should be updated with real-time data)
    EUR: {
        USD: 1.1,
        GBP: 0.85,
        EUR: 1.0,
    },
    USD: {
        EUR: 0.91,
        GBP: 0.77,
        USD: 1.0,
    },
    GBP: {
        EUR: 1.18,
        USD: 1.3,
        GBP: 1.0,
    },
}

/**
 * Converts an amount from one currency to another
 * @param {number} amount - The amount to convert
 * @param {string} fromCurrency - The source currency (EUR, USD, GBP)
 * @param {string} toCurrency - The target currency (EUR, USD, GBP)
 * @returns {number} The converted amount
 */
export const convertCurrency = (amount, fromCurrency, toCurrency) => {
    // If same currency, no conversion needed
    if (fromCurrency === toCurrency) {
        return amount
    }

    // Validate currencies
    if (!EXCHANGE_RATES[fromCurrency] || !EXCHANGE_RATES[fromCurrency][toCurrency]) {
        console.warn(`Currency conversion not supported: ${fromCurrency} to ${toCurrency}`)
        return amount // Return original amount if conversion not supported
    }

    const rate = EXCHANGE_RATES[fromCurrency][toCurrency]
    return amount * rate
}

/**
 * Formats a currency amount with the currency symbol
 * @param {number} amount - The amount to format
 * @param {string} currency - The currency code (EUR, USD, GBP)
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency) => {
    const symbols = {
        EUR: '€',
        USD: '$',
        GBP: '£',
    }

    const symbol = symbols[currency] || currency
    const roundedAmount = Math.round(amount)

    // For EUR, put symbol after the amount
    if (currency === 'EUR') {
        return `${roundedAmount} ${symbol}`
    }

    // For USD and GBP, put symbol before the amount
    return `${symbol}${roundedAmount}`
}

export default {
    convertCurrency,
    formatCurrency,
}
