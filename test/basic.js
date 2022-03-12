const test = require('tape')
const Unichain = require('@web4/unichain')
const ram = require('random-access-memory')

const { bufferize, causalValues } = require('./helpers')
const Bitstream = require('../')

test('linearizes short branches on long branches', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC]
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

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
  }

  // Add 3 more records to A -- should switch fork ordering
  for (let i = 1; i < 4; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'c2', 'c1', 'c0', 'a3', 'a2', 'a1', 'a0']))
  }

  t.end()
})

test('causal writes', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)
  const writerC = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB, writerC]
  })

  // Create three dependent branches
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }
  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, await bstream.latest(writerA), writerB)
  }
  for (let i = 0; i < 4; i++) {
    await bstream.append(`c${i}`, await bstream.latest(writerC), writerC)
  }

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'a0', 'c3', 'c2', 'c1', 'c0']))
  }

  // Add 4 more records to A -- should switch fork ordering
  for (let i = 1; i < 5; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'c3', 'c2', 'c1', 'c0', 'a4', 'a3', 'a2', 'a1', 'a0']))
  }

  t.end()
})

test('manually specifying clocks', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA, writerB]
  })

  await bstream.append('a0', await bstream.latest(writerA), writerA)
  await bstream.append('a1', await bstream.latest(writerA), writerA)
  await bstream.append('b0', [
    [writerA.key.toString('hex'), 2] // Links to a1
  ], writerB)
  await bstream.append('b1', await bstream.latest(writerB), writerB)
  await bstream.append('b2', await bstream.latest(writerB), writerB)

  const output = await causalValues(bstream)
  t.same(output.map(v => v.value), bufferize(['b2', 'b1', 'b0', 'a1', 'a0']))

  t.end()
})

test('supports a local input and default latest clocks', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)

  const bstream1 = new Bitstream({
    inputs: [writerA, writerB],
    localInput: writerA
  })
  const bstream2 = new Bitstream({
    inputs: [writerA, writerB],
    localInput: writerB
  })

  await bstream1.append('a0', await bstream1.latest())
  await bstream1.append('a1', await bstream1.latest())
  await bstream2.append('b0', await bstream2.latest())
  await bstream1.append('a2', await bstream1.latest())
  await bstream2.append('b1', await bstream2.latest())
  await bstream1.append('a3', await bstream1.latest())

  const output = await causalValues(bstream1)
  t.same(output.map(v => v.value), bufferize(['a3', 'b1', 'a2', 'b0', 'a1', 'a0']))
  t.same(output[0].change, writerA.key)
  t.same(output[1].change, writerB.key)

  t.end()
})

test('adding duplicate inputs is a no-op', async t => {
  const writerA = new Unichain(ram)
  const writerB = new Unichain(ram)

  const bstream1 = new Bitstream({
    inputs: [writerA, writerA, writerB, writerB],
    localInput: writerA
  })
  const bstream2 = new Bitstream({
    inputs: [writerA, writerB],
    localInput: writerB
  })

  await bstream2.addInput(writerA)
  await bstream2.addInput(writerB)

  t.same(bstream1.inputs.length, 2)
  t.same(bstream2.inputs.length, 2)

  await bstream1.append('a0', await bstream1.latest())
  await bstream1.append('a1', await bstream1.latest())
  await bstream2.append('b0', await bstream2.latest())
  await bstream1.append('a2', await bstream1.latest())
  await bstream2.append('b1', await bstream2.latest())
  await bstream1.append('a3', await bstream1.latest())

  const output = await causalValues(bstream1)
  t.same(output.map(v => v.value), bufferize(['a3', 'b1', 'a2', 'b0', 'a1', 'a0']))
  t.same(output[0].change, writerA.key)
  t.same(output[1].change, writerB.key)

  t.end()
})

test('dynamically adding/removing inputs', async t => {
  const writerA = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA]
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }
  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['a0']))
  }

  const writerB = new Unichain(ram)
  await bstream.addInput(writerB)

  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, await bstream.latest(writerB), writerB)
  }
  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['a0', 'b1', 'b0']))
  }

  const writerC = new Unichain(ram)
  await bstream.addInput(writerC)

  for (let i = 0; i < 3; i++) {
    await bstream.append(`c${i}`, await bstream.latest(writerC), writerC)
  }
  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['a0', 'b1', 'b0', 'c2', 'c1', 'c0']))
  }

  // Add 3 more records to A -- should switch fork ordering
  for (let i = 1; i < 4; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'c2', 'c1', 'c0', 'a3', 'a2', 'a1', 'a0']))
  }

  await bstream.removeInput(writerC)

  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['b1', 'b0', 'a3', 'a2', 'a1', 'a0']))
  }

  t.end()
})

test('dynamically adding inputs does not alter existing causal streams', async t => {
  const writerA = new Unichain(ram)

  const bstream = new Bitstream({
    inputs: [writerA]
  })

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await bstream.append(`a${i}`, await bstream.latest(writerA), writerA)
  }
  {
    const output = await causalValues(bstream)
    t.same(output.map(v => v.value), bufferize(['a0']))
  }

  const writerB = new Unichain(ram)
  await bstream.addInput(writerB)

  for (let i = 0; i < 2; i++) {
    await bstream.append(`b${i}`, await bstream.latest(writerB), writerB)
  }

  const output = []
  const stream = bstream.createCausalStream()
  await new Promise(resolve => stream.once('readable', resolve)) // Once the stream is opened, its heads are locked

  const writerC = new Unichain(ram)
  await bstream.addInput(writerC)

  for await (const node of stream) { // The stream should not have writerC's nodes
    output.push(node)
  }
  t.same(output.map(v => v.value), bufferize(['a0', 'b1', 'b0']))

  t.end()
})

test('can parse headers', async t => {
  const output = new Unichain(ram)
  const writer = new Unichain(ram)
  const notBitstream = new Unichain(ram)
  await notBitstream.append(Buffer.from('hello world'))

  const bstream = new Bitstream({
    inputs: [writer],
    outputs: [output],
    localInput: writer,
    localOutput: output,
    autostart: true
  })
  await bstream.append('a0')
  await bstream.view.update()

  t.true(await Bitstream.isBitstream(writer))
  t.true(await Bitstream.isBitstream(output))
  t.false(await Bitstream.isBitstream(notBitstream))

  t.end()
})

test('equal-sized forks are deterministically ordered by key', async t => {
  for (let i = 0; i < 5; i++) {
    const input1 = new Unichain(ram)
    const input2 = new Unichain(ram)
    const bstream = new Bitstream({
      inputs: [input1, input2],
      autostart: true
    })

    await bstream.append('i10', [], input1)
    await bstream.append('i11', [], input1)
    await bstream.append('i20', [], input2)
    await bstream.append('i21', [], input2)

    const values = (await causalValues(bstream)).map(v => v.value.toString())
    if (input1.key > input2.key) {
      t.same(values, ['i21', 'i20', 'i11', 'i10'])
    } else {
      t.same(values, ['i11', 'i10', 'i21', 'i20'])
    }
  }

  t.end()
})
