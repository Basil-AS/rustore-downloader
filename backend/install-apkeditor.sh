#!/bin/sh
set -eu
mkdir -p /opt/apkeditor
api='https://api.github.com/repos/REAndroid/APKEditor/releases/latest'
url="$(curl -fsSL "$api" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((a["browser_download_url"] for a in d.get("assets",[]) if a.get("name","").lower().endswith(".jar")), ""))')"
if [ -z "$url" ]; then
  echo 'APKEditor JAR asset not found; merged APK mode will be unavailable.' >&2
  exit 0
fi
curl -fL --retry 3 --connect-timeout 15 "$url" -o /opt/apkeditor/APKEditor.jar
java -jar /opt/apkeditor/APKEditor.jar -v || true
