const { validateDueDateForPersistence } = require('./dueDateValidation')

describe('validateDueDateForPersistence', () => {
    test('passes through undefined (field not provided)', () => {
        expect(validateDueDateForPersistence(undefined)).toBeUndefined()
    })

    test('accepts a positive finite millisecond timestamp', () => {
        expect(validateDueDateForPersistence(1755000000000)).toBe(1755000000000)
    })

    test('accepts Number.MAX_SAFE_INTEGER ("Someday")', () => {
        expect(validateDueDateForPersistence(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    })

    test.each([
        ['an object', { id: 'task-1', name: 'an entire task object' }, /received an object/],
        ['an array', [1755000000000], /received an array/],
        ['null', null, /received null/],
        ['a boolean', true, /received a boolean \(true\)/],
        ['zero', 0, /received an invalid number \(0\)/],
        ['a negative number', -86400000, /received an invalid number/],
        ['NaN', NaN, /received an invalid number \(NaN\)/],
        ['Infinity', Infinity, /received an invalid number \(Infinity\)/],
    ])('rejects %s', (label, value, expectedMessage) => {
        expect(() => validateDueDateForPersistence(value)).toThrow(/Invalid dueDate/)
        expect(() => validateDueDateForPersistence(value)).toThrow(expectedMessage)
    })

    test('names the original string when a date string failed to parse', () => {
        expect(() => validateDueDateForPersistence(NaN, 'not-a-real-date')).toThrow(
            'could not interpret "not-a-real-date" as a date'
        )
    })

    test('never serializes an object value into the error message', () => {
        expect(() => validateDueDateForPersistence({ dueDate: 123, name: 'secret task name' })).not.toThrow(
            /secret task name/
        )
    })

    test('truncates a very long raw string in the error message', () => {
        let message = ''
        try {
            validateDueDateForPersistence(NaN, 'x'.repeat(500))
        } catch (error) {
            message = error.message
        }
        expect(message).toContain('Invalid dueDate')
        expect(message).toContain('…')
        expect(message.length).toBeLessThan(300)
    })

    test('errors tell the model how to retry, including the Someday timestamp', () => {
        expect(() => validateDueDateForPersistence(null)).toThrow('9007199254740991')
        expect(() => validateDueDateForPersistence(null)).toThrow('ISO 8601')
    })
})
