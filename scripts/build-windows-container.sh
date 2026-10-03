#!/bin/sh
set -eu
# Run inside an official Rust image with build-essential, gcc-mingw-w64-x86-64 and nsis installed.
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
cargo build --release -p trace-agent --target x86_64-pc-windows-gnu
mkdir -p apps/desktop/src-tauri/binaries
cp target/x86_64-pc-windows-gnu/release/trace-agent.exe apps/desktop/src-tauri/binaries/trace-agent-x86_64-pc-windows-gnu.exe
cargo build --release -p trace-desktop --features custom-protocol --target x86_64-pc-windows-gnu
mkdir -p dist
cp target/x86_64-pc-windows-gnu/release/trace.exe dist/trace.exe
cp target/x86_64-pc-windows-gnu/release/trace-agent.exe dist/trace-agent.exe
loader_found=false
for loader in target/x86_64-pc-windows-gnu/release/build/webview2-com-sys-*/out/x64/WebView2Loader.dll; do
  if [ -f "$loader" ]; then
    cp "$loader" dist/WebView2Loader.dll
    loader_found=true
    break
  fi
done
if [ "$loader_found" != true ]; then
  echo "WebView2 loader missing from the Windows build output" >&2
  exit 1
fi
cd scripts
makensis installer.nsi
