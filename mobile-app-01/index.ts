import { registerRootComponent } from 'expo';

import App from './App';
import { initializeTriggerClassifierRuntime } from './src/ml/onnxTriggerRuntime';
import { triggerModelStatusReason } from './src/ml/mlRuntime';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Load the bundled INT8 ONNX model + real ALBERT tokenizer and bind the
// session-backed classifier. This is fire-and-forget BY DESIGN: every failure
// mode is caught inside the initializer and recorded as the unavailable
// reason, so the app fully works without ML inference (see
// ml/onnxTriggerRuntime.ts). The Insights screen reports the honest status.
void initializeTriggerClassifierRuntime().then((result) => {
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[ml] trigger classifier unavailable: ${result.reason}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[ml] trigger classifier ready');
});
void triggerModelStatusReason; // kept for the status surface (Urge/Insights)
