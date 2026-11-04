#!/usr/bin/env bash
set -euo pipefail

OS="$(uname -s)"

install_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    npm install -g pnpm@12
  fi
}

if [[ "$OS" == "Darwin" ]]; then
  # ----- macOS -----
  if ! command -v brew >/dev/null 2>&1; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew update

  # Node & npm
  command -v node >/dev/null 2>&1 || brew install node

  # Rust
  command -v rustup >/dev/null 2>&1 || (curl https://sh.rustup.rs -sSf | sh -s -- -y)
  export PATH="$HOME/.cargo/bin:$PATH"

  install_pnpm

  # JDK 17
  command -v javac >/dev/null 2>&1 || brew install openjdk@17
  export JAVA_HOME="$(brew --prefix openjdk@17)"
  export PATH="$JAVA_HOME/bin:$PATH"

  # Android SDK / NDK
  ANDROID_SDK="$HOME/Library/Android/sdk"
  mkdir -p "$ANDROID_SDK"
  if [[ ! -d "$ANDROID_SDK/cmdline-tools/latest" ]]; then
    curl -L -o "$ANDROID_SDK/cmdline-tools.zip" \
      https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip
    unzip -q "$ANDROID_SDK/cmdline-tools.zip" -d "$ANDROID_SDK"
    mkdir -p "$ANDROID_SDK/cmdline-tools"
    mv "$ANDROID_SDK/cmdline-tools"*/ "$ANDROID_SDK/cmdline-tools/latest"
    rm "$ANDROID_SDK/cmdline-tools.zip"
  fi
  export ANDROID_HOME="$ANDROID_SDK"
  export ANDROID_SDK_ROOT="$ANDROID_SDK"
  export PATH="$ANDROID_SDK/cmdline-tools/latest/bin:$ANDROID_SDK/platform-tools:$PATH"
  yes | sdkmanager --licenses >/dev/null
  sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"

elif [[ "$OS" =~ MINGW|MSYS|CYGWIN ]]; then
  # ----- Windows (Git Bash / MSYS2) -----
  if ! command -v choco >/dev/null 2>&1; then
    echo "Chocolatey is required. Install from https://chocolatey.org/install"
    exit 1
  fi

  command -v node >/dev/null 2>&1 || choco install -y nodejs-lts
  command -v rustup >/dev/null 2>&1 || choco install -y rustup.install && rustup default stable
  install_pnpm
  command -v javac >/dev/null 2>&1 || choco install -y openjdk17

  export JAVA_HOME="/c/Program Files/OpenJDK/openjdk-17"
  export PATH="$JAVA_HOME/bin:$PATH"

  ANDROID_SDK="$HOME/AppData/Local/Android/Sdk"
  mkdir -p "$ANDROID_SDK"
  if [[ ! -d "$ANDROID_SDK/cmdline-tools/latest" ]]; then
    curl -L -o "$ANDROID_SDK/cmdline-tools.zip" \
      https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip
    unzip -q "$ANDROID_SDK/cmdline-tools.zip" -d "$ANDROID_SDK"
    mkdir -p "$ANDROID_SDK/cmdline-tools"
    mv "$ANDROID_SDK/cmdline-tools"*/ "$ANDROID_SDK/cmdline-tools/latest"
    rm "$ANDROID_SDK/cmdline-tools.zip"
  fi
  export ANDROID_HOME="$ANDROID_SDK"
  export ANDROID_SDK_ROOT="$ANDROID_SDK"
  export PATH="$ANDROID_SDK/cmdline-tools/latest/bin:$ANDROID_SDK/platform-tools:$PATH"
  yes | sdkmanager --licenses >/dev/null
  sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"
else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "Environment configured. Run 'pnpm install', then 'pnpm tauri android build' to build the project."
