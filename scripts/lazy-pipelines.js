// Injected into every app page and worker script by fetch.mjs, before the app runs.
//
// WebGPU pipelines compile in the browser's GPU process, which every tab and the browser's own UI share.
// EffectCraft builds a compute pipeline for every effect kernel (hundreds) on startup, in the page and in
// each frame worker, which froze the whole browser for ~20 s. Hand the app a stand-in instead and compile
// the pipeline with createComputePipelineAsync, which runs on the GPU process's background threads; a
// pipeline used before that finishes is compiled on the spot.
if (globalThis.GPUDevice && globalThis.GPUComputePassEncoder) {
  const createComputePipeline = GPUDevice.prototype.createComputePipeline
  const createComputePipelineAsync = GPUDevice.prototype.createComputePipelineAsync
  const setPipeline = GPUComputePassEncoder.prototype.setPipeline
  const pending = new WeakMap() // stand-in -> [device, descriptor]
  const compiled = new WeakMap() // stand-in -> pipeline
  const done = (stub, pipeline) => {
    compiled.set(stub, pipeline)
    pending.delete(stub)
    return pipeline
  }
  const compile = (stub) => {
    if (compiled.has(stub)) return compiled.get(stub)
    const [device, descriptor] = pending.get(stub)
    return done(stub, createComputePipeline.call(device, descriptor))
  }
  class LazyComputePipeline {
    get label() {
      return pending.get(this)?.[1].label ?? compile(this).label
    }
    getBindGroupLayout(index) {
      return compile(this).getBindGroupLayout(index)
    }
  }
  GPUDevice.prototype.createComputePipeline = function (descriptor) {
    const stub = new LazyComputePipeline()
    const copy = { ...descriptor, compute: { ...descriptor.compute } }
    pending.set(stub, [this, copy])
    createComputePipelineAsync?.call(this, copy).then(
      (pipeline) => compiled.has(stub) || done(stub, pipeline),
      () => {}, // compiled on the spot when used, which reports the error the usual way
    )
    return stub
  }
  GPUComputePassEncoder.prototype.setPipeline = function (pipeline) {
    return setPipeline.call(this, pipeline instanceof LazyComputePipeline ? compile(pipeline) : pipeline)
  }
}
