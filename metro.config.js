// metro.config.js — extends the Expo default.
//
// This file exists purely so `npx expo-doctor` stops flagging that we're
// "using a custom metro config that doesn't extend expo/metro-config".
// Right now we don't override anything; if we ever need to tweak the
// resolver / transformer (e.g. for SVG support), do it on `config` here.
//
// Generated with Expo SDK 54 in mind. Keep this file checked in so EAS
// Build picks it up.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
