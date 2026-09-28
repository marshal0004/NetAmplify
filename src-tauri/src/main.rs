// /home/z/my-project/netamplify-app/src-tauri/src/main.rs
// NetAmplify — Tauri desktop app entry point.
//
// This binary boots the Tauri shell, which:
//   1. Starts the NestJS backend as a sidecar process (on port 3000)
//   2. Loads the React frontend (dev: localhost:4200, prod: bundled dist)
//   3. Registers Tauri commands for cookie capture + auto-refresh
//
// The frontend calls these commands via `window.__TAURI__.invoke()`
// to open native login windows, capture cookies, and proxy them to
// the local NestJS backend.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    netamplify_lib::run()
}
