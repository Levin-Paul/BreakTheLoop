# Android Signal Source (boundary only)

## Status

The native Android signal source is **not implemented**. `mobile-app-01/src/services/nativeSignalSource.ts`
defines the typed boundary and an honest stub that reports `ok: false`. Nothing
is registered, read, or collected.

## Intended flow

```
Android AccessibilityService (user-enabled, visible)
      -> minimal local signal        (RawSignal metadata only)
      -> privacy filter              (processSignal)
      -> local signal pipeline       (signalPipeline)
      -> local ML representation
```

## Next steps

1. Add an Expo config plugin that registers a Kotlin `AccessibilityService`.
2. Expose `start` / `stop` over a native module bridge mapping to `NativeSignalSource`.
3. Gate `start` behind an explicit, visible user toggle with a kill switch.
4. Map native events to `RawSignal` metadata only (coarse app category, activity
   type) and pass them through `processSignal()`.
5. Never request or store screen text, screenshots, or message contents.

## Hard rules

- Explicitly enabled by the user; visible; disableable.
- No covert surveillance.
- No raw screenshots or screen content captured or stored.
- No private messages read in the background.
- All processing local; nothing uploaded.
