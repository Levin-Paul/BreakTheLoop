const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The bundled ONNX model must be served as a binary file asset (not parsed),
// so InferenceSession.create() can read it from the local file URI.
config.resolver.assetExts.push('onnx');

module.exports = config;
