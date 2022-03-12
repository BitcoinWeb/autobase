const test = require('tape')
const ram = require('random-access-memory')
const Unichain = require('@web4/unichain')

const Bitstream = require('..')
const SimpleMultitree = require('../examples/multitree-simple')
const MultitreeWithResolution = require('../examples/multitree-with-resolution')

test('simple multitree', async t => {
  const firstUser = new Unichain(ram)
  const firstOutput = new Unichain(ram)
  const secondUser = new Unichain(ram)
  const secondOutput = new Unichain(ram)

  const inputs = [firstUser, secondUser]

  const bstream1 = new Bitstream({
    inputs,
    localOutput: firstOutput,
    localInput: firstUser
  })
  const bstream2 = new Bitstream({
    inputs,
    localOutput: secondOutput,
    localInput: secondUser
  })
  const bstream3 = new Bitstream({
    inputs,
    outputs: [firstOutput, secondOutput]
  })

  const writer1 = new SimpleMultitree(bstream1, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  const writer2 = new SimpleMultitree(bstream2, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  // Simulates a remote reader (not part of the group).
  const reader = new SimpleMultitree(bstream3, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })

  await writer1.put('a', 'a')
  await writer2.put('b', 'b')

  t.same(firstUser.length, 1)
  t.same(secondUser.length, 1)

  {
    const node = await writer2.get('a')
    t.true(node)
    t.same(node.value, 'a')
  }

  {
    const node = await writer1.get('b')
    t.true(node)
    t.same(node.value, 'b')
  }

  {
    const node = await reader.get('a')
    t.true(node)
    t.same(node.value, 'a')
  }

  // Both indexes should have processed two writes.
  t.same(firstOutput.length, 3)
  t.same(secondOutput.length, 3)

  t.end()
})

test('multitree with basic conflict resolution (only handles puts)', async t => {
  const firstUser = new Unichain(ram)
  const firstOutput = new Unichain(ram)
  const secondUser = new Unichain(ram)
  const secondOutput = new Unichain(ram)

  const inputs = [firstUser, secondUser]

  const bstream1 = new Bitstream({
    inputs,
    localOutput: firstOutput,
    localInput: firstUser
  })
  const bstream2 = new Bitstream({
    inputs,
    localOutput: secondOutput,
    localInput: secondUser
  })

  const writer1 = new MultitreeWithResolution(bstream1, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  const writer2 = new MultitreeWithResolution(bstream2, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })

  // Create two forking writes to 'a'
  await writer1.put('a', 'a', []) // [] means empty clock
  await writer1.put('b', 'b', []) // Two appends will shift writer1 to the back of the rebstreamd index.
  await writer1.put('c', 'c', []) // Two appends will shift writer1 to the back of the rebstreamd index.
  await writer2.put('a', 'a*', [])

  {
    const node = await writer2.get('a')
    t.true(node)
    t.same(node.value, 'a*') // Last one wins
  }

  // There should be one conflict for 'a'
  {
    const conflict = await writer2.get('_conflict/a')
    t.true(conflict)
  }

  // Fix the conflict with another write that causally references both previous writes.
  await writer2.put('a', 'resolved')

  {
    const node = await writer1.get('a')
    t.true(node)
    t.same(node.value, 'resolved')
  }

  // The conflict should be resolved
  {
    const conflict = await writer2.get('_conflict/a')
    t.false(conflict)
  }

  t.end()
})

/*
// TODO: Wrap Bittree extension to get this working
test.skip('multitree extension', async t => {
  const NUM_RECORDS = 5

  const store1 = await Chainstore.fromStorage(ram)
  const store2 = await Chainstore.fromStorage(ram)
  const store3 = await Chainstore.fromStorage(ram)
  // Replicate both chainstores
  replicateWithLatency(store1, store2)
  replicateWithLatency(store1, store3)

  const { user: firstUser } = await Bitstream.createUser(store1)
  const manifest = [firstUser]

  const tree1 = new Multitree(store1, manifest, firstUser, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  const tree2 = new Multitree(store2, Manifest.deflate(manifest), null, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  const tree3 = new Multitree(store3, Manifest.deflate(manifest), null, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8',
    extension: false
  })

  for (let i = 0; i < NUM_RECORDS; i++) {
    await tree1.put('' + i, '' + i)
  }
  await tree1.refresh()

  console.log('after put')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log(await collect(tree2.createReadStream()))

  const t0 = process.hrtime()
  const first = await collect(tree2.createReadStream())
  const t1 = process.hrtime(t0)

  const second = await collect(tree3.createReadStream())
  const t2 = process.hrtime(t0)

  t.same(first.length, NUM_RECORDS)
  t.same(second.length, NUM_RECORDS)
  console.log('t1:', t1, 't2:', t2, 't0:', t0)
  t.true(t1[1] < (t2[1] - t1[1]) / 2)

  console.log('first:', first)
  console.log('second:', second)

  t.end()
})

function replicateWithLatency (store1, store2, latency = 10) {
  const s1 = store1.replicate(true)
  const s2 = store2.replicate(false)
  s1.pipe(new LatencyStream(latency / 2)).pipe(s2).pipe(new LatencyStream(latency / 2)).pipe(s1)
}

async function collect (s) {
  const buf = []
  for await (const n of s) {
    buf.push(n)
  }
  return buf
}
*/
