const { Command } = require('commander')

const log = console.log

module.exports = {
    schema: () => {
        const program = new Command('schema')
        program.alias('sc').description('Manage database schema')

        program
            .command('validate')
            .alias('v')
            .description('schema database')
            .action(() => {
                console.log(program.opts())
            })

        return program
    },
}
