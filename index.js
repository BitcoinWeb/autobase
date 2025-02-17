const { EventEmitter } = require('events')

const safetyCatch = require('safety-catch')
const streamx = require('streamx')
const codecs = require('codecs')
const mutexify = require('mutexify/promise')
const c = require('compact-encoding')
const b = require('b4a')

const LinearizedView = require('./lib/linearize')
const MemberBatch = require('./lib/batch')
const KeyCompressor = require('./lib/compression')
const { InputNode, OutputNode } = require('./lib/nodes')
const { Node: NodeSchema, decodeHeader } = require('./lib/nodes/messages')

const INPUT_PROTOCOL = '@bitstream/input/v1'
const OUTPUT_PROTOCOL = '@bitstream/output/v1'

module.exports = class Bitstream extends EventEmitter {
  constructor ({ inputs, outputs, localInput, localOutput, apply, unwrap, autostart } = {}) {
    super()
    this.localInput = localInput
    this.localOutput = localOutput
    this.clock = null
    this.opened = false
    this.closed = false

    this._inputs = inputs || []
    this._outputs = outputs || []
    this._inputsByKey = new Map()
    this._outputsByKey = new Map()
    this._keyCompressors = new Map()
    this._readStreams = []
    this._batchId = 0
    this._lock = mutexify()

    this.view = null
    if (apply || autostart) this.start({ apply, unwrap })

    const self = this
    this._onappend = this._onInputAppended.bind(this)
    this._ontruncate = function (length) {
      self._onOutputTruncated(this, length)
    }

    this._opening = this._open()
    this._opening.catch(safetyCatch)
    this.ready = () => this._opening
  }

  // Private Methods

  async _open () {
    await Promise.all([
      ...this._inputs.map(i => i.ready()),
      ...this._outputs.map(o => o.ready())
    ])

    for (const input of this._inputs) {
      this._addInput(input)
    }
    for (const output of this._outputs) {
      this._addOutput(output)
    }

    this.opened = true
  }

  // Called by MemberBatch
  _addInput (input) {
    this._validateInput(input)

    const id = b.toString(input.key, 'hex')
    if (this._inputsByKey.has(id)) return

    this._inputsByKey.set(id, input)
    input.on('append', this._onappend)
  }

  // Called by MemberBatch
  _addOutput (output) {
    const id = b.toString(output.key, 'hex')
    if (this._outputsByKey.has(id)) return

    this.outputs.push(output)
    this._outputsByKey.set(id, output)
    output.on('truncate', this._ontruncate)
  }

  // Called by MemberBatch
  _removeInput (input) {
    const id = b.isBuffer(input) ? b.toString(input, 'hex') : b.toString(input.key, 'hex')
    if (!this._inputsByKey.has(id)) return

    input = this._inputsByKey.get(id)
    input.removeListener('append', this._onappend)
    this._inputsByKey.delete(id)
  }

  // Called by MemberBatch
  _removeOutput (output) {
    const id = b.isBuffer(output) ? b.toString(output, 'hex') : b.toString(output.key, 'hex')
    if (!this._outputsByKey.has(id)) return

    output = this._outputsByKey.get(id)
    output.removeListener('truncate', this._ontruncate)
    this._outputsByKey.delete(id)
  }

  _onOutputTruncated (output, length) {
    if (!this.view) return

    this.view._onOutputTruncated(output, length)
  }

  _onInputAppended () {
    this.emit('append')
    this._bumpReadStreams()
    this._getLatestClock() // Updates this.clock
  }

  _bumpReadStreams () {
    for (const stream of this._readStreams) {
      stream.bump()
    }
  }

  _validateInput (input) {
    if (input.valueEncoding && input.valueEncoding !== codecs.binary) {
      throw new Error('Unichain inputs must be binary ones')
    }
  }

  _getKeyCompressor (input) {
    let keyCompressor = this._keyCompressors.get(input)
    if (!keyCompressor) {
      keyCompressor = new KeyCompressor(input)
      this._keyCompressors.set(input, keyCompressor)
    }
    return keyCompressor
  }

  async _decompressClock (input, seq, clock) {
    const keyCompressor = this._getKeyCompressor(input)
    return keyCompressor.decompress(clock, seq)
  }

  async _compressClock (input, seq, clock) {
    const keyCompressor = this._getKeyCompressor(input)
    return keyCompressor.compress(clock, seq)
  }

  async _getInputNode (input, seq, opts) {
    if (seq < 0) return null
    if (b.isBuffer(input)) input = b.toString(input, 'hex')
    if (typeof input === 'string') {
      if (!this._inputsByKey.has(input)) return null
      input = this._inputsByKey.get(input)
    }

    const block = await input.get(seq, opts)
    if (!block) return null

    let decoded = null
    try {
      decoded = NodeSchema.decode({ start: 0, end: block.length, buffer: block })
    } catch (err) {
      return safetyCatch(err)
    }

    let clock = await this._decompressClock(input, seq, decoded.clock)
    const node = new InputNode({ ...decoded, clock, key: input.key, seq })

    if (node.batch[1] !== 0) {
      const batchEnd = await this._getInputNode(input, seq + node.batch[1])
      clock = batchEnd.clock
    }

    node.clock = clock
    if (node.seq > 0) node.clock.set(node.id, node.seq - 1)
    else node.clock.delete(node.id)

    return node
  }

  // Public API

  get inputs () {
    return [...this._inputsByKey.values()]
  }

  get outputs () {
    return [...this._outputsByKey.values()]
  }

  get started () {
    return !!this.view
  }

  start ({ apply, unwrap } = {}) {
    if (this.view) throw new Error('Start must only be called once')
    this.view = new LinearizedView(this, {
      header: { protocol: OUTPUT_PROTOCOL },
      apply,
      unwrap
    })
  }

  async heads () {
    if (!this.opened) await this._opening
    await Promise.all(this.inputs.map(i => i.update()))
    return Promise.all(this.inputs.map(i => this._getInputNode(i, i.length - 1)))
  }

  _getLatestClock (inputs) {
    if (!inputs) inputs = this.inputs
    if (!Array.isArray(inputs)) inputs = [inputs]

    const clock = new Map()
    for (const input of inputs) {
      const id = b.toString(input.key, 'hex')
      if (!this._inputsByKey.has(id)) throw new Error('Unichain is not an input of the Bitstream')
      if (input.length === 0) continue
      clock.set(id, input.length - 1)
    }

    this.clock = clock
    return clock
  }

  async latest (inputs) {
    if (!this.opened) await this._opening
    await Promise.all(this.inputs.map(i => i.update()))
    return this._getLatestClock(inputs)
  }

  memberBatch () {
    return new MemberBatch(this)
  }

  async addInput (input) {
    const batch = new MemberBatch(this)
    batch.addInput(input)
    return batch.commit()
  }

  async removeInput (input) {
    const batch = new MemberBatch(this)
    batch.removeInput(input)
    return batch.commit()
  }

  async addOutput (output) {
    const batch = new MemberBatch(this)
    batch.addOutput(output)
    return batch.commit()
  }

  async removeOutput (output) {
    const batch = new MemberBatch(this)
    batch.removeOutput(output)
    return batch.commit()
  }

  createCausalStream (opts = {}) {
    const self = this
    let heads = null

    return new streamx.Readable({ open, read })

    function open (cb) {
      self.heads()
        .then(h => { heads = h })
        .then(() => cb(null), err => cb(err))
    }

    function read (cb) {
      const { forks, clock, smallest } = forkInfo(heads)

      if (!forks.length) {
        this.push(null)
        return cb(null)
      }

      const node = forks[smallest]
      const forkIndex = heads.indexOf(node)
      this.push(new OutputNode({ ...node, change: node.key, clock }))

      // TODO: When reading a batch node, parallel download them all (use batch[0])
      // TODO: Make a causal stream extension for faster reads

      if (node.seq === 0) {
        heads.splice(forkIndex, 1)
        return cb(null)
      }

      self._getInputNode(node.id, node.seq - 1).then(next => {
        heads[forkIndex] = next
        return cb(null)
      }, err => cb(err))
    }
  }

  createReadStream (opts = {}) {
    const self = this

    const positionsByKey = opts.checkpoint || new Map()
    const nodesByKey = new Map()
    const snapshotLengthsByKey = new Map()

    const wait = opts.wait !== false
    let running = false
    let bumped = false

    const stream = new streamx.Readable({
      open: cb => _open().then(cb, cb),
      read: cb => _read().then(cb, cb)
    })
    stream.bump = () => {
      bumped = true
      _read().catch(err => stream.destroy(err))
    }
    stream.checkpoint = positionsByKey

    this._readStreams.push(stream)
    stream.once('close', () => {
      const idx = this._readStreams.indexOf(stream)
      if (idx === -1) return
      this._readStreams.splice(idx, 1)
    })

    return stream

    async function _open (cb) {
      if (!self.opened) await self._opening
      await maybeSnapshot()
      await updateAll()
    }

    async function _read () {
      if (running) return
      running = true
      try {
        while (!streamx.Readable.isBackpressured(stream)) {
          await updateAll()
          while (bumped) {
            bumped = false
            await updateAll()
          }

          const oldest = findOldestNode(nodesByKey)

          if (!oldest) {
            if (opts.live) return
            stream.push(null)
            return
          }

          const unsatisfied = hasUnsatisfiedInputs(oldest, self._inputsByKey)
          if (unsatisfied && opts.onresolve) {
            const resolved = await opts.onresolve(oldest)
            if (resolved !== false) continue
            // If resolved is false, yield the unresolved node as usual
          }

          const pos = positionsByKey.get(oldest.id)
          nodesByKey.delete(oldest.id)
          positionsByKey.set(oldest.id, pos + 1)

          const mapped = opts.map ? opts.map(oldest) : oldest
          stream.push(mapped)

          if (opts.onwait) await opts.onwait(mapped)
        }
      } finally {
        running = false
      }
    }

    async function maybeSnapshot () {
      for (const [key, input] of self._inputsByKey) {
        await input.update()
        if (!opts.live) snapshotLengthsByKey.set(key, input.length)
      }
    }

    async function updateAll () {
      const allowUpdates = opts.live || opts.onresolve || opts.onwait // TODO: Make this behavior more customizable
      const inputKeys = allowUpdates ? self._inputsByKey.keys() : snapshotLengthsByKey.keys()

      const loadPromises = []
      for (const key of inputKeys) {
        const input = self._inputsByKey.get(key)

        let pos = positionsByKey.get(key)
        if (pos === undefined) {
          pos = opts.tail === true ? input.length : 0
          positionsByKey.set(key, pos)
        }

        const snapshotLength = snapshotLengthsByKey.get(key)
        if (snapshotLength) {
          if (pos >= snapshotLength) continue
        } else {
          if (pos >= input.length && wait) await input.update()
          if (pos >= input.length) continue
        }

        loadPromises.push(self._getInputNode(input, pos, { wait }).then(node => [key, node]))
      }

      for (const [key, node] of await Promise.all(loadPromises)) {
        nodesByKey.set(key, node)
      }
    }

    function findOldestNode (nodesByKey) {
      for (const node of nodesByKey.values()) {
        if (!node) continue
        let oldest = true
        for (const n2 of nodesByKey.values()) {
          if (!n2 || n2 === node) continue
          if (n2.lte(node)) oldest = false
        }
        if (oldest) return node
      }
      return null
    }

    function hasUnsatisfiedInputs (node, inputsByKey) {
      for (const key of node.clock.keys()) {
        if (!inputsByKey.has(key)) return true
      }
      return false
    }
  }

  async _createInputBatch (input, batch, clock) {
    const nodes = []
    // Only the last node in the batch contains the clock/keys
    const compressed = await this._compressClock(input, input.length + batch.length - 1, clock)

    for (let i = 0; i < batch.length; i++) {
      const batchOffset = (batch.length !== 1) ? [i, batch.length - 1 - i] : null
      const node = {
        value: !b.isBuffer(batch[i]) ? b.from(batch[i]) : batch[i],
        key: input.key,
        batch: batchOffset,
        clock: null,
        keys: null
      }
      if (i === batch.length - 1) {
        node.clock = compressed.clock
        node.keys = compressed.keys
      }
      nodes.push(node)
    }

    if (input.length === 0) {
      nodes[0].header = {
        protocol: INPUT_PROTOCOL
      }
    }

    return nodes.map(node => c.encode(NodeSchema, node))
  }

  async _append (value, clock, input) {
    if (clock !== null && !Array.isArray(clock) && !(clock instanceof Map)) {
      input = clock
      clock = null
    }
    if (!Array.isArray(value)) value = [value]

    clock = clockToMap(clock || this._getLatestClock())
    input = input || this.localInput

    // Make sure that causal information propagates.
    // This is tracking inputs that were present in the previous append, but have since been removed.
    const head = await this._getInputNode(input, input.length - 1)
    const inputId = b.toString(input.key, 'hex')
    if (clock.has(inputId)) {
      // Remove self-links
      clock.delete(inputId)
    }
    if (head && head.clock) {
      for (const [id, seq] of head.clock) {
        if (id === inputId || clock.has(id)) continue
        clock.set(id, seq)
      }
    }

    const batch = await this._createInputBatch(input, value, clock)
    return input.append(batch)
  }

  async append (value, clock, input) {
    if (!this.opened) await this._opening
    const release = await this._lock()
    try {
      return await this._append(value, clock, input)
    } finally {
      release()
    }
  }

  close () {
    if (this.closed) return
    for (const input of this.inputs) {
      input.removeListener('append', this._onappend)
    }
    for (const output of this.outputs) {
      output.removeListener('truncate', this._ontruncate)
    }
    this.closed = true
  }

  static async isBitstream (chain) {
    if (chain.length === 0) return false
    try {
      const block = await chain.get(0, { valueEncoding: 'binary' })
      const header = decodeHeader(block)
      const protocol = header && header.protocol
      return !!protocol && (protocol === INPUT_PROTOCOL || protocol === OUTPUT_PROTOCOL)
    } catch {
      return false
    }
  }
}

function isFork (head, heads) {
  if (!head) return false
  for (const other of heads) {
    if (!other) continue
    if (head.lte(other)) return false
  }
  return true
}

function forkSize (node, i, heads) {
  const high = {}

  for (const head of heads) {
    if (head === node) continue
    for (const [key, seq] of head.clock) {
      const length = seq + 1
      if (length > (high[key] || 0)) high[key] = length
    }
  }

  let s = 0

  for (const [key, seq] of node.clock) {
    const length = seq + 1
    const h = high[key] || 0
    if (length > h) s += length - h
  }

  return s
}

function forkInfo (heads) {
  const forks = []
  const clock = new Map()

  for (const head of heads) {
    if (!head) continue
    if (isFork(head, heads)) forks.push(head)
    clock.set(head.id, head.seq)
  }

  const sizes = forks.map(forkSize)
  let smallest = 0
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i] === sizes[smallest] && forks[i].key < forks[smallest].key) {
      smallest = i
    } else if (sizes[i] < sizes[smallest]) {
      smallest = i
    }
  }

  return {
    forks,
    clock,
    smallest
  }
}

function clockToMap (clock) {
  if (!clock) return new Map()
  if (clock instanceof Map) return clock
  if (Array.isArray(clock)) return new Map(clock)
  return new Map(Object.entries(clock))
}
