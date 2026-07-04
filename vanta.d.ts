declare module 'vanta/dist/vanta.net.min' {
  const effect: (opts: Record<string, unknown>) => { destroy: () => void }
  export default effect
}

declare module 'three'
declare module 'three/examples/jsm/postprocessing/EffectComposer.js'
declare module 'three/examples/jsm/postprocessing/RenderPass.js'
declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
declare module 'three/examples/jsm/postprocessing/OutputPass.js'
declare module 'three/examples/jsm/controls/OrbitControls.js'
