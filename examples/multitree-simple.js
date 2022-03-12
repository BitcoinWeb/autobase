const Bittree = require('@web4/bittree')

module.exports = class SimpleMultitree {
  constructor (bitstream, opts) {
    this.bitstream = bitstream
    this.bitstream.start({
      unwrap: true,
      apply: this._apply.bind(this)
    })
    this.tree = new Bittree(this.bitstream.view, {
      ...opts,
      extension: false
    })
  }

  ready () {
    return this.bitstream.ready()
  }

  // A real apply function would need to handle conflicts, beyond last-one-wins.
  async _apply (batch) {
    const b = this.tree.batch({ update: false })
    for (const node of batch) {
      const op = JSON.parse(node.value.toString())
      // TODO: Handle deletions
      if (op.type === 'put') await b.put(op.key, op.value)
    }
    await b.flush()
  }

  async put (key, value, opts = {}) {
    const op = Buffer.from(JSON.stringify({ type: 'put', key, value }))
    return await this.bitstream.append(op)
  }

  async get (key) {
    return await this.tree.get(key)
  }
}
