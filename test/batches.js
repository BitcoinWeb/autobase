const test = require('tape')
const Unichain = require('@web4/unichain')
const ram = require('random-access-memory')

const { bufferize, causalValues } = require('./helpers')
const Bitstream = require('../')

test('batches array-valued appends using partial input nodes', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC]
  })

  // Create three dependent forks
  await bstream.append(['a0'], await bstream.latest(writerA), writerA)
  await bstream.append(['b0', 'b1'], await bstream.latest(writerA), writerB)
  await bstream.append(['c0', 'c1', 'c2'], await bstream.latest(writerA), writerC)

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'c2', 'c1', 'c0', 'a0']))
  }

  // Add 4 more records to A -- should switch fork ordering
  for (let i = 1; i < 5; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'c2', 'c1', 'c0', 'a4', 'a3', 'a2', 'a1', 'a0']))
  }

  t.end()
})
