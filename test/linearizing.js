const test = require('tape')
const Unichain = require('@web4/umichain')
const ram = require('random-access-memory')

const { bufferize, linearizedValues } = require('./helpers')
const Bitstream = require('../')

test('linearizing - three independent forks', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  // Add 3 more records to A -- should switch fork ordering
  for (let i = 1; i < 4; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['b1', 'b0', 'c2', 'c1', 'c0', 'a3', 'a2', 'a1', 'a0']))
    t.same(bstream.view.status.added, 9)
    t.same(bstream.view.status.removed, 6)
    t.same(output.length, 9)
  }

  t.end()
})

test('linearizing - causal writes preserve clock', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three causally-linked forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, writerC)
  }

  const outputNodes = await linearizedValues(bstream.view)

  t.same(outputNodes.map(v => v.value), bufferize(['c2', 'c1', 'c0', 'b1', 'b0', 'a0']))
  t.same(bstream.view.status.added, 6)
  t.same(bstream.view.status.removed, 0)
  t.same(output.length, 6)

  for (let i = 1; i < bstream.view.length; i++) {
    const prev = await bstream.view.get(i - 1)
    const node = await bstream.view.get(i)
    t.true(prev.lte(node))
  }

  t.end()
})

test('linearizing - does not over-truncate', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 5; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 8)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 8)
  }

  // Add 3 more records to A -- should switch fork ordering (A after C)
  for (let i = 1; i < 4; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['b1', 'b0', 'a3', 'a2', 'a1', 'a0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 3)
    t.same(output.length, 11)
  }

  // Add 1 more record to B -- should not cause any reordering
  await bstream.append('b2', [], writerB)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['b2', 'b1', 'b0', 'a3', 'a2', 'a1', 'a0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 1)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 12)
  }

  t.end()
})

test('linearizing - can cut out a writer', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 5; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 8)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 8)
  }

  // Cut out writer B. Should truncate 3
  await bstream.removeInput(writerB)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 1) // a0 is reindexed
    t.same(bstream.view.status.removed, 3) // a0 is popped and reindexed
    t.same(output.length, 6)
  }

  t.end()
})

test('linearizing - can cut out a writer from the back', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 5; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b4', 'b3', 'b2', 'b1', 'b0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  await bstream.removeInput(writerB)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0']))
    t.same(bstream.view.status.added, 1) // a0 is reindexed
    t.same(bstream.view.status.removed, 6) // a0 is popped and reindexed
    t.same(output.length, 1)
  }

  t.end()
})

test('linearizing - can cut out a writer from the front', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 5; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b4', 'b3', 'b2', 'b1', 'b0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  await bstream.removeInput(writerA)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['b4', 'b3', 'b2', 'b1', 'b0']))
    t.same(bstream.view.status.added, 0) // a0 is removed
    t.same(bstream.view.status.removed, 1) // a0 is removed
    t.same(output.length, 5)
  }

  t.end()
})

test('linearizing - can cut out a writer, causal writes', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three causally-linked forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, await bstream.latest([writerB, writerA]), writerB)
  }
  for (let i = 0; i < 5; i++) {
    await bstream.append(`c${i}`, await bstream.latest(writerC), writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['b1', 'b0', 'a0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 8)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 8)
  }

  // Cut out writer B. Should truncate 3
  await bstream.removeInput(writerB)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'c4', 'c3', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 0) // b1 and b0 are removed
    t.same(bstream.view.status.removed, 2) // b1 and b0 are removed
    t.same(output.length, 6)
  }

  t.end()
})

test('linearizing - can cut out a writer, causal writes interleaved', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB],
    localOutput: output,
    autostart: true
  })

  for (let i = 0; i < 6; i++) {
    if (i % 2) {
      await bstream.append(`a${i}`, await bstream.latest(), writerA)
    } else {
      await bstream.append(`b${i}`, await bstream.latest(), writerB)
    }
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a5', 'b4', 'a3', 'b2', 'a1', 'b0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  await bstream.removeInput(writerB)

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a5', 'a3', 'a1']))
    t.same(bstream.view.status.added, 3)
    t.same(bstream.view.status.removed, 6)
    t.same(output.length, 3)
  }

  t.end()
})

test('linearizing - many writers, no causal writes', async t => {
  const NUM_WRITERS = 10
  const NUM_APPENDS = 11

  const output = new Unichain(ram)
  const writers = []

  for (let i = 1; i < NUM_WRITERS + 1; i++) {
    const writer = new Unichain(ram)
    writers.push(writer)
  }
  const middleWriter = writers[Math.floor(writers.length / 2)]

  const bstream = new Bitstream({
    inputs: writers,
    localOutput: output,
    autostart: true
  })
  for (let i = 1; i < NUM_WRITERS + 1; i++) {
    const writer = writers[i - 1]
    for (let j = 0; j < i; j++) {
      await bstream.append(`w${i}-${j}`, [], writer)
    }
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.length, (NUM_WRITERS * (NUM_WRITERS + 1)) / 2)
  }

  // Appending to the middle writer NUM_APPEND times should shift it to the back of the index.
  for (let i = 0; i < NUM_APPENDS; i++) {
    await bstream.append(`new entry ${i}`, [], middleWriter)
  }

  await bstream.view.update()

  for (let i = 0; i < NUM_APPENDS + Math.floor(writers.length / 2); i++) {
    const latestNode = await bstream.view.get(i)
    const val = latestNode.value.toString()
    t.same(val, (await bstream._getInputNode(middleWriter, i)).value.toString())
  }

  t.end()
})

test('linearizing - double-linearizing is a no-op', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 0)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  t.end()
})

test('linearizing - selects longest remote output', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const output1 = new Unichain(ram)
  const output2 = new Unichain(ram)
  const output3 = new Unichain(ram)

  const inputs = [writerA, writerB, writerC]
  const bstream1 = new Bitstream({
    inputs,
    localOutput: output1
  })
  const bstream2 = new Bitstream({
    inputs,
    localOutput: output2
  })
  const bstream3 = new Bitstream({
    inputs,
    localOutput: output3
  })
  bstream1.start()
  bstream2.start()
  bstream3.start()

  // Create three independent forks and linearize them into separate outputs
  for (let i = 0; i < 3; i++) {
    await bstream1.append(`a${i}`, [], writerA)
  }

  await bstream1.view.update()

  for (let i = 0; i < 2; i++) {
    await bstream1.append(`b${i}`, [], writerB)
  }

  await bstream2.view.update()

  for (let i = 0; i < 1; i++) {
    await bstream1.append(`c${i}`, [], writerC)
  }

  await bstream3.view.update()

  {
    // Should not have to modify output3
    const bstream = new Bitstream({
      inputs,
      outputs: [output3],
      autostart: true
    })
    await bstream.view.update()
    t.same(bstream.view.status.added, 0)
    t.same(bstream.view.status.removed, 0)
    t.same(bstream.view.length, 6)
  }

  {
    // Should not have to add B and C
    const bstream = new Bitstream({
      inputs,
      outputs: [output1],
      autostart: true
    })
    await bstream.view.update()
    t.same(bstream.view.status.added, 3)
    t.same(bstream.view.status.removed, 0)
    t.same(bstream.view.length, 6)
  }

  {
    // Should select output2
    const bstream = new Bitstream({
      inputs,
      outputs: [output1, output2],
      autostart: true
    })
    await bstream.view.update()
    t.same(bstream.view.status.added, 1)
    t.same(bstream.view.status.removed, 0)
    t.same(bstream.view.length, 6)
  }

  {
    // Should select output3
    const bstream = new Bitstream({
      inputs,
      outputs: [output1, output2, output3],
      autostart: true
    })
    await bstream.view.update()
    t.same(bstream.view.status.added, 0)
    t.same(bstream.view.status.removed, 0)
    t.same(bstream.view.length, 6)
  }

  t.end()
})

test('linearizing - can dynamically add/remove default outputs', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const output1 = new Unichain(ram)
  const output2 = new Unichain(ram)
  const output3 = new Unichain(ram)

  const inputs = [writerA, writerB, writerC]
  const bstream1 = new Bitstream({
    inputs,
    localOutput: output1
  })
  const bstream2 = new Bitstream({
    inputs,
    localOutput: output2
  })
  const bstream3 = new Bitstream({
    inputs,
    localOutput: output3
  })
  bstream1.start()
  bstream2.start()
  bstream3.start()

  // Create three independent forks, and linearize them into separate outputs
  for (let i = 0; i < 3; i++) {
    await bstream1.append(`a${i}`, [], writerA)
  }

  await bstream1.view.update()

  for (let i = 0; i < 2; i++) {
    await bstream1.append(`b${i}`, [], writerB)
  }

  await bstream2.view.update()

  for (let i = 0; i < 1; i++) {
    await bstream1.append(`c${i}`, [], writerC)
  }

  await bstream3.view.update()

  const bstream4 = new Bitstream({
    inputs,
    outputs: [output1]
  })
  bstream4.start()

  await bstream4.view.update()
  t.same(bstream4.view.status.added, 3)
  t.same(bstream4.view.status.removed, 0)
  t.same(bstream4.view.length, 6)

  await bstream4.addOutput(output2)

  await bstream4.view.update()
  t.same(bstream4.view.status.added, 1)
  t.same(bstream4.view.status.removed, 0)
  t.same(bstream4.view.length, 6)

  await bstream4.addOutput(output3)

  await bstream4.view.update()
  t.same(bstream4.view.status.added, 0)
  t.same(bstream4.view.status.removed, 0)
  t.same(bstream4.view.length, 6)

  t.end()
})

test('linearizing - can locally extend an out-of-date remote output', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const output1 = new Unichain(ram)

  const inputs = [writerA, writerB, writerC]
  const writerBase = new Bitstream({
    inputs,
    localOutput: output1,
    autostart: true
  })
  const readerBase = new Bitstream({
    inputs,
    outputs: [output1],
    autostart: true
  })

  for (let i = 0; i < 3; i++) {
    await writerBase.append(`a${i}`, [], writerA)
  }
  await writerBase.view.update()
  await readerBase.view.update()

  t.same(writerBase.view.status.added, 3)
  t.same(writerBase.view.status.removed, 0)
  t.same(writerBase.view.length, 3)
  t.same(readerBase.view.status.added, 0)
  t.same(readerBase.view.status.removed, 0)
  t.same(readerBase.view.length, 3)

  for (let i = 0; i < 2; i++) {
    await writerBase.append(`b${i}`, [], writerB)
  }

  await readerBase.view.update()
  t.same(readerBase.view.status.added, 2)
  t.same(readerBase.view.status.removed, 0)
  t.same(readerBase.view.length, 5)

  for (let i = 0; i < 1; i++) {
    await writerBase.append(`c${i}`, [], writerC)
  }

  await readerBase.view.update()
  t.same(readerBase.view.status.added, 1)
  t.same(readerBase.view.status.removed, 0)
  t.same(readerBase.view.length, 6)

  // Extend C and lock the previous forks (will not reorg)
  for (let i = 1; i < 4; i++) {
    await writerBase.append(`c${i}`, writerC)
  }

  await readerBase.view.update()
  t.same(readerBase.view.status.added, 3)
  t.same(readerBase.view.status.removed, 0)
  t.same(readerBase.view.length, 9)

  // Create a new B fork at the back (full reorg)
  for (let i = 1; i < 11; i++) {
    await writerBase.append(`b${i}`, [], writerB)
  }

  await readerBase.view.update()
  t.same(readerBase.view.status.added, 19)
  t.same(readerBase.view.status.removed, 9)
  t.same(readerBase.view.length, 19)

  t.end()
})

test('linearizing - will discard local in-memory view if remote is updated', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const output1 = new Unichain(ram)

  const inputs = [writerA, writerB, writerC]
  const writerBase = new Bitstream({
    inputs,
    localOutput: output1,
    autostart: true
  })
  const readerBase = new Bitstream({
    inputs,
    outputs: [output1],
    autostart: true
  })

  for (let i = 0; i < 3; i++) {
    await writerBase.append(`a${i}`, [], writerA)
  }

  await writerBase.view.update() // Pull the first 3 nodes into output1
  await readerBase.view.update()
  t.same(readerBase.view._bestLinearizer.committed.length, 0) // It should start up-to-date

  for (let i = 0; i < 2; i++) {
    await writerBase.append(`b${i}`, [], writerB)
  }

  await readerBase.view.update() // view extends output1 in memory
  t.same(readerBase.view._bestLinearizer.committed.length, 2)

  for (let i = 0; i < 1; i++) {
    await writerBase.append(`c${i}`, [], writerC)
  }

  await readerBase.view.update()
  t.same(readerBase.view._bestLinearizer.committed.length, 3)

  // Pull the latest changes into the output1
  await writerBase.view.update()
  await readerBase.view.update()
  t.same(readerBase.view._bestLinearizer.committed.length, 0)

  t.end()
})

test('linearizing - linearize operations are debounced', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    localOutput: output,
    autostart: true
  })

  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  await Promise.all([
    bstream.view.update(),
    bstream.view.update(),
    bstream.view.update(),
    bstream.view.update()
  ])

  const outputNodes = []
  for (let i = 0; i < bstream.view.length; i++) {
    outputNodes.push(await bstream.view.get(i))
  }
  outputNodes.reverse()

  t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
  t.same(output.length, 6)

  t.end()
})

test('closing a view will cleanup event listeners', async t => {
  const output1 = new Unichain(ram)
  const output2 = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const inputs = [writerA, writerB, writerC]
  const bstream1 = new Bitstream({
    inputs,
    outputs: [output1]
  })
  const bstream2 = new Bitstream({
    inputs,
    outputs: [output2]
  })

  for (let i = 0; i < 1; i++) {
    await bstream1.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream1.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream1.append(`c${i}`, [], writerC)
  }

  t.same(writerA.listenerCount('append'), 2)
  t.same(output1.listenerCount('truncate'), 1)
  t.same(output2.listenerCount('truncate'), 1)

  await bstream1.close()

  t.same(writerA.listenerCount('append'), 1)
  t.same(output1.listenerCount('truncate'), 0)

  await bstream2.close()

  t.same(writerA.listenerCount('append'), 0)
  t.same(output2.listenerCount('truncate'), 0)

  t.end()
})

test('can dynamically add a default output', async t => {
  const output = new Unichain(ram)
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC],
    autostart: true
  })

  t.false(bstream.view.writable)

  bstream.localOutput = output

  t.true(bstream.view.writable)

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, [], writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, [], writerB)
  }
  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, [], writerC)
  }

  {
    const outputNodes = await linearizedValues(bstream.view)
    t.same(outputNodes.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
    t.same(bstream.view.status.added, 6)
    t.same(bstream.view.status.removed, 0)
    t.same(output.length, 6)
  }

  t.end()
})
