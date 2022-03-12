const test = require('tape')
const Unichain = require('@web4/unichain')
const ram = require('random-access-memory')

const { bufferize, linearizedValues } = require('./helpers')
const Bitstream = require('../')

test('map with stateless mapper', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output
  })
  bstream.start({
    apply (batch) {
      batch = batch.map(({ value }) => Buffer.from(value.toString('utf-8').toUpperCase(), 'utf-8'))
      return bstream.view.append(batch)
    }
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, await bstream.latest(writerB), writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, await bstream.latest(writerC), writerC)
  }

  const outputNodes = await linearizedValues(bstream.view)
  t.same(outputNodes.map(v => v.value), bufferize(['A0', 'B1', 'B0', 'C2', 'C1', 'C0']))

  t.end()
})

test('mapping into batches yields the correct clock on reads', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output
  })
  bstream.start({
    apply (batch) {
      batch = batch.map(({ value }) => Buffer.from(value.toString('utf-8').toUpperCase(), 'utf-8'))
      return bstream.view.append(batch)
    }
  })

  // Create three independent forks
  await bstream.append(['a0'], [], writerA)
  await bstream.append(['b0', 'b1'], [], writerB)
  await bstream.append(['c0', 'c1', 'c2'], [], writerC)

  const outputNodes = await linearizedValues(bstream.view)
  t.same(outputNodes.map(v => v.value), bufferize(['A0', 'B1', 'B0', 'C2', 'C1', 'C0']))

  t.end()
})
