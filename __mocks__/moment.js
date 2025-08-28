const moment = jest.requireActual('moment')

Date.now = () => new Date('2019-04-22T10:20:30Z').getTime()

module.exports = moment
