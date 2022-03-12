const test = require('tape')
const Unichain = require('@web4/unichain')
const ram = require('random-access-memory')

const Bitstream = require('../')

test('should throw if unichain valueEncoding is utf-8', async t => {
  const chainWithUtf8 = new Unichain(ram, { valueEncoding: 'utf-8' })

  const bstream = new Bitstream({
    inputs: [chainWithUtf8]
  })

  try {
    await bstream.ready()
    t.fail('should not be ready')
  } catch (error) {
    t.equal(error.message, 'Unichain inputs must be binary ones')
  }
})

test('should throw if unichain valueEncoding is json', async t => {
  const chainWithJson = new Unichain(ram, { valueEncoding: 'json' })

  const bstream = new Bitstream({
    inputs: [chainWithJson]
  })

  try {
    await bstream.ready()
    t.fail('should not be ready')
  } catch (error) {
    t.equal(error.message, 'Unichain inputs must be binary ones')
  }
})

test('should not throw if unichain valueEncoding is binary', async t => {
  const chainWithBinary = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [chainWithBinary]
  })

  try {
    await bstream.ready()
    t.pass('should be ready')
  } catch {
    t.fail('should not throw')
  }
})

test('should throw if utf8 encoded unichain is added dynamically', async t => {
  const bstream = new Bitstream()

  try {
    const chainWithUtf8 = new Unichain(ram, { valueEncoding: 'utf-8' })
    await bstream.addInput(chainWithUtf8)
    t.fail('should not be resolved')
  } catch (err) {
    t.equal(err.message, 'Unichain inputs must be binary ones')
  }
})

test('should throw if json encoded unichain is added dynamically', async t => {
  const bstream = new Bitstream()

  try {
    const chainWithJson = new Unichain(ram, { valueEncoding: 'json' })
    await bstream.addInput(chainWithJson)
    t.fail('should not be resolved')
  } catch (err) {
    t.equal(err.message, 'Unichain inputs must be binary ones')
  }
})

test('should not throw if unichain valueEncoding is binary', async t => {
  const chainWithBinary = new Unichain(ram)
  const bstream = new Bitstream()

  try {
    await bstream.addInput(chainWithBinary)
    t.pass('should be ready')
  } catch {
    t.fail('Should not throw')
  }
})
