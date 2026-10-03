# Basis Universal transcoder

`basis_transcoder.js` and `basis_transcoder.wasm` are copied unchanged from three.js r186
(`three/examples/jsm/libs/basis/`, Apache-2.0, Binomial LLC). The KTX2 loader
(`src/render/ktx2.ts`) loads them from here to turn the game's KTX2 textures into
whatever compressed format the GPU supports. Copy them again when three.js is upgraded.
