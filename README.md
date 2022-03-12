# BitStream

*⚠️ Alpha Warning ⚠️ - BitStream only works with the alpha release of [Unichain 2](https://github.com/bitwebs/unichain-next)*

Automatically rebase multiple causally-linked Unichains into a single, linearized Unichain.

The output of an Bitstream is "just a Unichain", which means it can be used to transform higher-level data structures (like Bittree) into multiwriter data structures with minimal additional work.

These multiwriter data structures operate using an event-sourcing pattern, where Bitstream inputs are "operation logs", and outputs are indexed views over those logs.

## Installation
```
npm install @web4/bitstream
```

## Usage
An Bitstream is constructed from a known set of trusted input Unichains. Authorizing these inputs is outside of the scope of Bitstream -- this module is unopinionated about trust, and assumes it comes from another channel.

Here's how you would create an Bitstream from 3 known inputs, and a locally-available (writable) default input:
``` js
const bitstream = require('@web4/bitstream')

// Assuming inputA, inputB, and inputC are Unichain 2 instances
// inputA will be used during append operations
const bstream = new Bitstream({
  inputs: [inputA, inputB, inputC],
  localInput: inputA,
  autostart: true
})

// Add a few messages to the local writer.
// These messages will contain the Bitstream's latest vector clock by default.
await bstream.append('hello')
await bstream.append('world')

// bstream.view is a linearized view Unichain with causal ordering. `output` is a Unichain.
// When bstream.view.update() is called, the inputs will be automatically linearized and stored into the output.

// Use `view` as you would any other Unichain.
await bstream.view.update()
await bstream.view.get(0)
```

Bitstream lets you write concise multiwriter data structures. As an example, a multiwriter Bittree (with basic, last-one-wins conflict resolution) can be written with [~40 lines of code](examples/multitree-simple.js).

In addition multiwriter data structures built on Bitstream inherit the same feature set as Unichain. This means that users can securely query a multiwriter data structure built with Bitstream by only downloading a fraction of the data.

## API

#### `const bstream = new Bitstream({ inputs, outputs, ...opts } = {})`
Creates a new Bitstream from a set of input/output Unichains

Options include:

```js
{
  inputs: [],        // The list of Unichains for Bitstream to linearize
  outputs: [],       // An optional list of output Unichains containing linearied views
  localInput: null,  // The Unichain that will be written to in bstream.append operations
  localOutput: null, // A writable Unichain that linearized views will be persisted into
  autostart: false,  // Create a linearized view (bstream.view) immediately
  apply: null,       // Create a linearized view (bstream.view) immediately using this apply function
  unwrap: false      // bstream.view.get calls will return node values only instead of full nodes
}
```

#### `bstream.inputs`
The list of input Unichains.

#### `bstream.outputs`
The list of output Unichains containing persisted linearized views.

#### `bstream.localInput`
If non-null, this Unichain will be appended to in bstream.append operations.

#### `bstream.localOutput`
If non-null, `bstream.view` will be persisted into this Unichain.

#### `const clock = bstream.clock()`
Returns a Map containing the latest lengths for all Bitstream inputs.

The Map has the form: `(hex-encoded-key) -> (Unichain length)`

#### `await Bitstream.isBitstream(chain)`
Returns `true` if `chain` is an Bitstream input or an output.

#### `await bstream.append(value, [clock], [input])`
Append a new value to the bitstream.

* `clock`: The causal clock and defaults to bstream.latest.

#### `const clock = await bstream.latest([input1, input2, ...])`
Generate a causal clock linking the latest entries of each input.

`latest` will update the input Unichains (`input.update()`) prior to returning the clock.

You generally will not need to use this, and can instead just use `append` with the default clock:
```js
await bstream.append('hello world')
```

#### `await bstream.addInput(input)`
Adds a new input Unichain.

* `input` must either be a fresh Unichain, or a Unichain that has previously been used as an Bitstream input.

#### `await bstream.removeInput(input)`
Removes an input Unichain.

* `input` must be a Unichain that is currently an input.

__A Note about Removal__

Removing an input, and then subsequently linearizing the Bitstream into an existing output, could result in a large truncation operation on that output -- this is effectively "purging" that input entirely.

In the future, we're planning to add support for "soft removal", which will freeze an input at a specific length, and not process blocks past that length, while still preserving that input's history in linearized views. For most applications, soft removal matches the intuition behind "removing a user".

#### `await bstream.addOutput(output)`
Adds a new output Unichain.

* `output` must be either a fresh Unichain, or a Unichain that was previously used as an Bitstream output.

If `bstream.outputs` is not empty, Bitstream will do "remote linearizing": `bstream.view.update()` will treat these outputs as the "trunk", minimizing the amount of local re-processing they need to do during updates.

#### `await bstream.removeOutput(output)`
Removes an output Unichain. `output` can be either a Unichain, or a Unichain key.

* `output` must be a Unichain, or a Unichain key, that is currently an output (in `bstream.outputs`).

## API - Two Kinds of Streams

In order to generate shareable linearized views, Bitstream must first be able to generate a deterministic, causal ordering over all the operations in its input Unichains.

Every input node contains embedded causal information (a vector clock) linking it to previous nodes. By default, when a node is appended without additional options (i.e. `bstream.append('hello')`), Bitstream will embed a clock containing the latest known lengths of all other inputs.

Using the vector clocks in the input nodes, Bitstream can generate two types of streams:

### Causal Streams
Causal streams start at the heads (the last blocks) of all inputs, and walk backwards and yield nodes with a deterministic ordering (based on both the clock and the input key) such that anybody who regenerates this stream will observe the same ordering, given the same inputs.

They should fail in the presence of unavailable nodes -- the deterministic ordering ensures that any indexer will process input nodes in the same order.

The simplest kind of linearized view (`const view = bstream.linearize()`), is just a Unichain containing the results of a causal stream in reversed order (block N in the index will not be causally-dependent on block N+1).

#### `const stream = bstream.createCausalStream()`
Generate a Readable stream of input blocks with deterministic, causal ordering.

Any two users who create an Bitstream with the same set of inputs, and the same lengths (i.e. both users have the same initial states), will produce identical causal streams.

If an input node is causally-dependent on another node that is not available, the causal stream will not proceed past that node, as this would produce inconsistent output.

### Read Streams

Similar to `Unichain.createReadStream()`, this stream starts at the beginning of each input, and does not guarantee the same deterministic ordering as the causal stream. Unlike causal streams, which are used mainly for indexing, read streams can be used to observe updates. And since they move forward in time, they can be live.

#### `const stream = bstream.createReadStream(opts = {})`
Generate a Readable stream of input blocks, from earliest to latest.

Unlike `createCausalStream`, the ordering of `createReadStream` is not deterministic. The read stream only gives you the guarantee that every node it yields will __not__ be causally-dependent on any node yielded later.

Read streams have a public property `checkpoint`, which can be used to create new read streams that resume from the checkpoint's position:
```js
const stream1 = bstream.createReadStream()
// Do something with stream1 here
const stream2 = bstream.createReadStream({ checkpoint: stream1.checkpoint }) // Resume from stream1.checkpoint

```

`createReadStream` can be passed two custom async hooks:
* `onresolve`: Called when an unsatisfied node (a node that links to an unknown input) is encountered. Can be used to dynamically add inputs to the Bitstream.
  * Returning `true` indicates that you added new inputs to the Bitstream, and so the read stream should begin processing those inputs.
  * Returning `false` indicates that you did not resolve the missing links, and so the node should be yielded immediately as is.
* `onwait`: Called after each node is yielded. Can be used to dynamically add inputs to the Bitstream.

Options include:
```js
{
  live: false, // Enable live mode (the stream will continuously yield new nodes)
  tail: false, // When in live mode, start at the latest clock instead of the earliest
  map: (node) => node // A sync map function,
  checkpoint: null, // Resume from where a previous read stream left off (`readStream.checkpoint`)
  wait: true, // If false, the read stream will only yield previously-downloaded blocks.
  onresolve: async (node) => true | false, // A resolve hook (described above)
  onwait: async (node) => undefined // A wait hook (described above)
}
```

## API - Linearized Views

Bitstream is designed for computing and sharing linearized views over many input Unichains. A linearized view is a "merged" view over the inputs, giving you a way of interacting with the N input Unichains as though it were a single, combined Unichain.

These views, instances of the `LinearizedView` class, in many ways look and feel like normal Unichains. They support `get`, `update`, and `length` operations.

By default, a view is just a persisted version of an Bitstream's causal stream, saved into a Unichain. But you can do a lot more with them: by passing a function into `linearize`'s `apply` option, you can define your own indexing strategies.

Linearized views are incredible powerful as they can be persisted to a Unichain using the new `truncate` API added in Unichain 10. This means that peers querying a multiwriter data structure don't need to read in all changes and apply them themself. Instead they can start from an existing view that's shared by another peer. If that view is missing indexing any data from inputs, Bitstream will create a "view over the remote view", applying only the changes necessary to bring the remote view up-to-date. The best thing is that this all happens automatically for you!

### Customizing Views with `apply`

The default linearized view is just a persisted causal stream -- input nodes are recorded into an output Unichain in causal order, with no further modifications. This minimally-processed view is useful on its own for applications that don't follow an event-sourcing pattern (i.e. chat), but most use-cases involve processing operations in the inputs into indexed representations.

To support indexing, `bstream.start` can be provided with an `apply` function that's passed batches of input nodes during rebasing, and can choose what to store in the output. Inside `apply`, the view can be directly mutated through the `view.append` method, and these mutations will be batched when the call exits.

The simplest `apply` function is just a mapper, a function that modifies each input node and saves it into the view in a one-to-one fashion. Here's an example that uppercases String inputs, and saves the resulting view into an `output` Unichain:
```js
bstream.start({
  async apply (batch) {
    batch = batch.map(({ value }) => Buffer.from(value.toString('utf-8').toUpperCase(), 'utf-8'))
    await view.append(batch)
  }
})
// After bstream.start, the linearized view is available as a property on the Bitstream
await bstream.view.update()
console.log(bstream.view.length)
```

More sophisticated indexing might require multiple appends per input node, or reading from the view during `apply` -- both are perfectly valid. The [multiwriter Bittree example](examples/autobee-simple.js) shows how this `apply` pattern can be used to build Unichain-based indexing data structures using this approach.

### View Creation

#### `bstream.started`
A Boolean indicating if `bstream.view` has been created.

See the [linearized views section]() for details about the `apply` and `unwrap` options.

Prior to calling `bstream.start()`, `bstream.view` will be `null`.

#### `bstream.start({ apply, unwrap } = {})`
Creates a new linearized view, and set it on `bstream.view`. The view mirrors the Unichain API wherever possible, meaning it can be used whereever you would normally use a Unichain.

You can either call `bstream.start` manually when you want to start using `bstream.view`, or you can pass either `apply` or `autostart` options to the Bitstream constructor. If these constructor options are present, Bitstream will start immediately.

If you choose to call `bstream.start` manually, it must only be called once.

Options include:
```js
{
  unwrap: false // Set this to auto unwrap the gets to only return .value
  apply (batch) {} // The apply function described above
}
```

#### `view.status`
The status of the last linearize operation.

Returns an object of the form `{ added: N, removed: M }` where:
* `added` indicates how many nodes were appended to the output during the linearization
* `removed` incidates how many nodes were truncated from the output during the linearization

#### `view.length`
The length of the view. Similar to `unichain.length`.

#### `await view.update()`
Make sure the view is up to date.

#### `const entry = await view.get(idx, opts)`
Get an entry from the view. If you set `unwrap` to true, it returns `entry.value`.
Otherwise it returns an entry similar to this:

```js
{
  clock, // the causal clock this entry was created at
  value // the value that is stored here
}
```

#### `await view.append([blocks])`

__Note__: This operation can only be performed inside the `apply` function.

## License

MIT
