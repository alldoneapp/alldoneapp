/**
 * Phone number validation and formatting utility
 * Formats phone numbers to +countrycode format (e.g., +491795384943)
 */

// Common country codes mapping
const COUNTRY_CODES = {
    // Major countries
    DE: '49', // Germany
    US: '1', // United States
    CA: '1', // Canada
    GB: '44', // United Kingdom
    FR: '33', // France
    ES: '34', // Spain
    IT: '39', // Italy
    NL: '31', // Netherlands
    BE: '32', // Belgium
    CH: '41', // Switzerland
    AT: '43', // Austria
    PL: '48', // Poland
    CZ: '420', // Czech Republic
    DK: '45', // Denmark
    SE: '46', // Sweden
    NO: '47', // Norway
    FI: '358', // Finland
    RU: '7', // Russia
    CN: '86', // China
    JP: '81', // Japan
    KR: '82', // South Korea
    AU: '61', // Australia
    BR: '55', // Brazil
    MX: '52', // Mexico
    AR: '54', // Argentina
    IN: '91', // India
    TR: '90', // Turkey
    SA: '966', // Saudi Arabia
    AE: '971', // UAE
    EG: '20', // Egypt
    ZA: '27', // South Africa
}

/**
 * Clean phone number by removing all non-digit characters except +
 */
function cleanPhoneNumber(phone) {
    return phone.replace(/[^\d+]/g, '')
}

/**
 * Detect if phone number already has country code
 */
function hasCountryCode(phone) {
    const cleaned = cleanPhoneNumber(phone)
    return cleaned.startsWith('+') || cleaned.length > 10
}

/**
 * Format phone number to international format (+countrycode + number)
 * @param {string} phone - Input phone number in any format
 * @param {string} defaultCountryCode - Default country code to use if none detected (default: '49' for Germany)
 * @returns {string} - Formatted phone number in +countrycode format
 */
export function formatPhoneNumber(phone, defaultCountryCode = '49') {
    if (!phone) return ''

    const cleaned = cleanPhoneNumber(phone)

    // If already starts with +, just clean it
    if (cleaned.startsWith('+')) {
        return cleaned
    }

    // If starts with 00, replace with +
    if (cleaned.startsWith('00')) {
        return '+' + cleaned.substring(2)
    }

    // If it's a long number (likely has country code), try to detect
    if (cleaned.length > 10) {
        // Check common country code prefixes
        for (const [country, code] of Object.entries(COUNTRY_CODES)) {
            if (cleaned.startsWith(code)) {
                return '+' + cleaned
            }
        }
    }

    // If starts with 0 (national format), remove leading 0 and add default country code
    if (cleaned.startsWith('0')) {
        return '+' + defaultCountryCode + cleaned.substring(1)
    }

    // If no country code detected, add default
    return '+' + defaultCountryCode + cleaned
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {Object} - {isValid: boolean, error: string, formatted: string}
 */
export function validatePhoneNumber(phone, defaultCountryCode = '49') {
    if (!phone || phone.trim() === '') {
        return { isValid: true, error: '', formatted: '' }
    }

    const cleaned = cleanPhoneNumber(phone)

    // Check minimum length (at least 7 digits total)
    if (cleaned.replace(/^\+/, '').length < 7) {
        return {
            isValid: false,
            error: 'Phone number too short',
            formatted: phone,
        }
    }

    // Check maximum length (no more than 15 digits as per ITU-T E.164)
    if (cleaned.replace(/^\+/, '').length > 15) {
        return {
            isValid: false,
            error: 'Phone number too long',
            formatted: phone,
        }
    }

    const formatted = formatPhoneNumber(phone, defaultCountryCode)

    return {
        isValid: true,
        error: '',
        formatted: formatted,
    }
}

/**
 * Get display format for phone number (adds spaces for readability)
 * @param {string} phone - Phone number in +countrycode format
 * @returns {string} - Display formatted phone number
 */
export function getDisplayPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return phone || ''
    if (!phone.startsWith('+')) return phone

    // Add spaces for readability: +49 179 5384943
    const cleaned = phone.replace(/[^\d+]/g, '')
    if (cleaned.length <= 3) return cleaned

    const countryCode = cleaned.match(/^\+(\d{1,3})/)?.[1] || ''
    const number = cleaned.substring(countryCode.length + 1)

    if (number.length <= 3) {
        return `+${countryCode} ${number}`.trim()
    }

    // Format: +CC XXX XXXXXXX
    const part1 = number.substring(0, 3)
    const part2 = number.substring(3)

    return `+${countryCode} ${part1} ${part2}`.trim()
}
