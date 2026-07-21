// package.json "main" is "expo-router/entry" — THAT is the real entry.
//
// This file used to be the Expo template entry that did
// `registerRootComponent(App)` with the placeholder App.tsx ("Open up
// App.tsx…"). If the bundler ever resolved this file as the entry (it did
// when main was briefly pointed at a custom index), it registered the WRONG
// root component and the release build crashed at launch with
// "Application 'main' has not been registered". Booting expo-router here
// instead makes this file safe no matter what resolves it.
import 'expo-router/entry';
