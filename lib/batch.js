class MemberBatch {
  constructor (bitstream) {
    this.bitstream = bitstream
    this.batchId = bitstream._batchId
    this._ops = []
  }

  addInput (chain) {
    this._ops.push({ type: MemberBatch.ADD_INPUT, chain })
  }

  addOutput (chain) {
    this._ops.push({ type: MemberBatch.ADD_OUTPUT, chain })
  }

  removeInput (chain) {
    this._ops.push({ type: MemberBatch.REMOVE_INPUT, chain })
  }

  removeOutput (chain) {
    this._ops.push({ type: MemberBatch.REMOVE_OUTPUT, chain })
  }

  async commit () {
    await this.bitstream.ready()
    await Promise.all(this._ops.map(({ chain }) => (typeof chain.ready === 'function') ? chain.ready() : Promise.resolve()))

    if (this.batchId !== this.bitstream._batchId) throw new Error('Batch is out-of-date. Did you commit another batch in parallel?')
    this.bitstream._batchId++

    for (const op of this._ops) {
      switch (op.type) {
        case MemberBatch.ADD_INPUT:
          this.bitstream._addInput(op.chain)
          break
        case MemberBatch.ADD_OUTPUT:
          this.bitstream._addOutput(op.chain)
          break
        case MemberBatch.REMOVE_INPUT:
          this.bitstream._removeInput(op.chain)
          break
        case MemberBatch.REMOVE_OUTPUT:
          this.bitstream._removeOutput(op.chain)
          break
        default:
          throw new Error('Unsupported MemberBatch operation')
      }
    }

    this.bitstream._bumpReadStreams()
  }
}
MemberBatch.ADD_INPUT = 0
MemberBatch.ADD_OUTPUT = 1
MemberBatch.REMOVE_INPUT = 2
MemberBatch.REMOVE_OUTPUT = 3

module.exports = MemberBatch
