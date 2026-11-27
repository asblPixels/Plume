#!/usr/bin/env bash
set -euo pipefail

version=$(node -p "require('../package.json').version")
code=$(node -p "require('../package.json').version.split('.').reduce((n, part) => n * 100 + Number(part), 0)")
build_tools=$(find "${ANDROID_HOME:?ANDROID_HOME est requis}/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
chmod +x gradlew
mkdir -p ../../out

if [[ -n "${PLUME_ANDROID_KEYSTORE_B64:-}${PLUME_ANDROID_STORE_PASSWORD:-}${PLUME_ANDROID_KEY_PASSWORD:-}" ]]; then
  : "${PLUME_ANDROID_KEYSTORE_B64:?Clé de publication Android requise}"
  : "${PLUME_ANDROID_STORE_PASSWORD:?Mot de passe du keystore requis}"
  : "${PLUME_ANDROID_KEY_PASSWORD:?Mot de passe de la clé requis}"
  : "${PLUME_ANDROID_KEY_ALIAS:?Alias de signature requis}"
  if [[ ! "${PLUME_ANDROID_CERT_SHA256:-}" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo "L’empreinte SHA-256 du certificat Android est requise." >&2
    exit 1
  fi

  env -u PLUME_ANDROID_KEYSTORE_B64 -u PLUME_ANDROID_STORE_PASSWORD -u PLUME_ANDROID_KEY_PASSWORD \
    ./gradlew assembleRelease --no-daemon
  signing_dir=$(mktemp -d)
  trap 'rm -rf -- "$signing_dir"' EXIT
  printf '%s' "$PLUME_ANDROID_KEYSTORE_B64" | base64 --decode > "$signing_dir/release.keystore"
  "$build_tools/zipalign" -f -P 16 4 app/build/outputs/apk/release/app-release-unsigned.apk "$signing_dir/aligned.apk"
  "$build_tools/apksigner" sign --ks "$signing_dir/release.keystore" --ks-key-alias "$PLUME_ANDROID_KEY_ALIAS" \
    --ks-pass env:PLUME_ANDROID_STORE_PASSWORD --key-pass env:PLUME_ANDROID_KEY_PASSWORD \
    --out "$signing_dir/signed.apk" "$signing_dir/aligned.apk"
  apk="$signing_dir/signed.apk"
  actual=$("$build_tools/apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
  if [[ "${actual,,}" != "${PLUME_ANDROID_CERT_SHA256,,}" ]]; then
    echo "Le certificat de signature Android ne correspond pas à l’empreinte attendue." >&2
    exit 1
  fi
  destination="../../out/Plume-$version-android.apk"
else
  if [[ "${PLUME_REQUIRE_SIGNED_RELEASE:-}" == 'true' &&
        ( ${GITHUB_REF:-} == refs/heads/release/* || ${GITHUB_REF:-} == refs/tags/v* ) ]]; then
    echo "La clé de publication Android est exigée pour cette publication." >&2
    exit 1
  fi
  ./gradlew assembleDebug --no-daemon
  apk="app/build/outputs/apk/debug/app-debug.apk"
  destination="../../out/Plume-$version-android-debug.apk"
fi

"$build_tools/apksigner" verify "$apk"
badging=$("$build_tools/aapt" dump badging "$apk")
grep -F "package: name='be.asblpixels.plume' versionCode='$code' versionName='$version'" <<<"$badging"
cp "$apk" "$destination"
