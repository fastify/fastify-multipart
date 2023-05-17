'use strict'

const { Suite } = require('benchmark')
const { generateId } = require('../lib/generateId')

const suite = new Suite()

suite.add('id', generateId)

suite
  .on('cycle', function (event) {
    console.log(String(event.target))
  })
  .on('complete', function () {
    console.log('Fastest is ' + this.filter('fastest').map('name'))
    console.log('Slowest is ' + this.filter('slowest').map('name'))
  })
  .run()
