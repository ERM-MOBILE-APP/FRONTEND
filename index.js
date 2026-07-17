// NOT the app entry. package.json "main" is "expo-router/entry".
//
// (An earlier attempt made this the custom entry to register the background
// location task headlessly, but with the leftover template index.ts present
// the bundler booted the placeholder App instead of expo-router. Reverted.)
//
// The background location TaskManager task is registered by the top-level
// `import '../services/locationTask'` in app/_layout.tsx, which expo-router
// evaluates when it builds its route tree at bundle load.
export {};
