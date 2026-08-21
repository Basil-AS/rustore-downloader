from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Literal
from urllib.parse import quote
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.background import BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from gplaydl import api as play_api
from gplaydl.auth import api_key_for, dispenser_base, ensure_auth, fetch_token_for_profile
from gplaydl.download import DownloadSpec, download_batch
from gplaydl.profiles import get_compat_profiles, get_discovery_profiles, get_priority_profiles

APP_NAME = "Google Play APK Downloader API"
APP_VERSION = "1.0.0"
PACKAGE_RE = re.compile(r"^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$")
ARCHES = ("arm64", "armv7", "x86_64", "x86", "tv")
MANIFEST_TTL = int(os.getenv("MANIFEST_TTL", "2700"))
MAX_MANIFESTS = int(os.getenv("MAX_MANIFESTS", "64"))
MAX_SCAN_PROFILES = int(os.getenv("MAX_SCAN_PROFILES", "12"))
DISPENSER_URL = os.getenv("GPLAYDL_DISPENSER_URL") or None
ACCOUNT_EMAIL = os.getenv("GPLAYDL_EMAIL") or None
APKEDITOR_JAR = Path(os.getenv("APKEDITOR_JAR", "/opt/apkeditor/APKEditor.jar"))
MERGE_KEYSTORE = Path(os.getenv("MERGE_KEYSTORE", "/data/merge-keystore.p12"))
MERGE_STOREPASS = os.getenv("MERGE_STOREPASS", "play-downloader-local")
MERGE_ALIAS = os.getenv("MERGE_ALIAS", "play-downloader")


def _origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "*").strip()
    return ["*"] if raw == "*" else [x.strip().rstrip("/") for x in raw.split(",") if x.strip()]


app = FastAPI(title=APP_NAME, version=APP_VERSION, description="Resolve and download original Google Play APK/split/OBB delivery files.")
app.add_middleware(CORSMiddleware, allow_origins=_origins(), allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"], expose_headers=["Content-Disposition", "Content-Length"])


@dataclass(slots=True)
class FileRef:
    id: str
    name: str
    kind: str
    size: int
    sha1: str = ""
    sha256: str = ""
    url: str = ""
    cookies: list[dict] = field(default_factory=list)
    gzipped: bool = False

    def public(self, manifest_id: str) -> dict:
        return {"id": self.id, "name": self.name, "kind": self.kind, "size": self.size, "sha1": self.sha1, "sha256": self.sha256, "download": f"/api/file/{manifest_id}/{self.id}"}


@dataclass(slots=True)
class Variant:
    id: str
    arch: str
    profile: str
    device: str
    sdk: int
    density: int
    abis: str
    locales: list[str]
    version_code: int
    version_name: str
    files: list[FileRef]

    def public(self, manifest_id: str) -> dict:
        return {
            "id": self.id, "arch": self.arch, "profile": self.profile, "device": self.device,
            "sdk": self.sdk, "density": self.density, "abis": self.abis, "locales": self.locales,
            "versionCode": self.version_code, "versionName": self.version_name,
            "files": [f.public(manifest_id) for f in self.files],
            "archives": {
                "zip": f"/api/archive/{manifest_id}?variant={self.id}&format=zip",
                "apks": f"/api/archive/{manifest_id}?variant={self.id}&format=apks",
                "mergedApk": f"/api/archive/{manifest_id}?variant={self.id}&format=merged",
            },
        }


@dataclass(slots=True)
class Manifest:
    id: str
    package: str
    title: str
    developer: str
    created_at: float
    variants: list[Variant]

    def public(self) -> dict:
        versions = sorted({v.version_code for v in self.variants}, reverse=True)
        return {
            "id": self.id, "package": self.package, "title": self.title, "developer": self.developer,
            "createdAt": int(self.created_at * 1000), "expiresAt": int((self.created_at + MANIFEST_TTL) * 1000),
            "versionCodes": versions, "variants": [v.public(self.id) for v in self.variants],
            "archives": {"allZip": f"/api/archive/{self.id}?variant=all&format=zip"},
            "limitations": [
                "Google Play returns only versions and device-targeted variants that it still serves to the paired account.",
                "Merged APK is reconstructed and locally re-signed; original split files remain Google-signed.",
            ],
        }


_CACHE: dict[str, Manifest] = {}
_CACHE_LOCK = threading.Lock()


def _cleanup_cache() -> None:
    now = time.time()
    with _CACHE_LOCK:
        expired = [k for k, v in _CACHE.items() if now - v.created_at > MANIFEST_TTL]
        for key in expired:
            _CACHE.pop(key, None)
        if len(_CACHE) > MAX_MANIFESTS:
            for key, _ in sorted(_CACHE.items(), key=lambda item: item[1].created_at)[: len(_CACHE) - MAX_MANIFESTS]:
                _CACHE.pop(key, None)


def _get_manifest(manifest_id: str) -> Manifest:
    _cleanup_cache()
    with _CACHE_LOCK:
        manifest = _CACHE.get(manifest_id)
    if not manifest:
        raise HTTPException(404, "Manifest expired or not found. Resolve the app again.")
    return manifest


def _safe_package(package: str) -> str:
    package = package.strip()
    if not PACKAGE_RE.fullmatch(package):
        raise HTTPException(422, "Invalid Android package name")
    return package


def _safe_int(value: str | int | None, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def _normalize_locale(value: str) -> str:
    value = value.strip().replace("_", "-")
    if not value:
        return ""
    parts = value.split("-", 1)
    lang = parts[0].lower()
    if not re.fullmatch(r"[a-z]{2,3}", lang):
        raise ValueError(f"Invalid locale: {value}")
    if len(parts) == 1:
        return lang
    region = parts[1]
    if not re.fullmatch(r"[A-Za-z0-9]{2,8}", region):
        raise ValueError(f"Invalid locale: {value}")
    return f"{lang}-{region.upper() if len(region) == 2 else region}"


class ResolveRequest(BaseModel):
    package: str
    architectures: list[Literal["arm64", "armv7", "x86_64", "x86", "tv"]] = Field(default_factory=lambda: ["arm64"])
    locales: list[str] = Field(default_factory=lambda: ["en-US"])
    versionCode: int | None = Field(default=None, ge=1)
    deepScan: bool = False
    forceRefresh: bool = False

    @field_validator("package")
    @classmethod
    def validate_package(cls, value: str) -> str:
        value = value.strip()
        if not PACKAGE_RE.fullmatch(value):
            raise ValueError("Invalid Android package name")
        return value

    @field_validator("architectures")
    @classmethod
    def validate_arches(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("Select at least one architecture")
        out: list[str] = []
        for arch in value:
            if arch not in out:
                out.append(arch)
        return out

    @field_validator("locales")
    @classmethod
    def validate_locales(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for locale in value or ["en-US"]:
            normalized = _normalize_locale(locale)
            if normalized and normalized not in out:
                out.append(normalized)
        if "en-US" not in out and "en" not in out:
            out.insert(0, "en-US")
        return out[:16]


class SearchResult(BaseModel):
    package: str
    title: str
    creator: str = ""


def _linked() -> bool:
    return bool(api_key_for(dispenser_base(DISPENSER_URL)))


def _require_auth(arch: str, force_refresh: bool = False) -> dict:
    try:
        auth = ensure_auth(arch=arch, dispenser_url=DISPENSER_URL, force_refresh=force_refresh, email=ACCOUNT_EMAIL)
    except Exception as exc:
        raise HTTPException(502, f"Google Play authentication failed: {exc}") from exc
    if not auth or not auth.get("authToken"):
        raise HTTPException(503, "Backend is not linked to gplaydl. Run `gplaydl link` in the backend container or set GPLAYDL_API_KEY.")
    return auth


def _profile_meta(profile_key: str, profile: dict, arch: str) -> tuple[str, int, int, str]:
    device = profile.get("UserReadableName") or profile.get("Build.MODEL") or profile_key or arch
    return device, _safe_int(profile.get("Build.VERSION.SDK_INT")), _safe_int(profile.get("Screen.Density")), profile.get("Platforms") or profile.get("Build.SUPPORTED_ABIS") or arch


def _slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return value.strip("._-")[:120] or "file"


def _files_from_delivery(package: str, version_code: int, delivery: play_api.DeliveryResult) -> list[FileRef]:
    files: list[FileRef] = []
    base_url = delivery.download_url or delivery.gzipped_url
    if not base_url:
        return files
    files.append(FileRef(id=secrets.token_urlsafe(8), name=f"{package}-{version_code}-base.apk", kind="base", size=delivery.download_size or delivery.gzipped_size, sha1=delivery.sha1, sha256=delivery.sha256, url=base_url, cookies=list(delivery.cookies), gzipped=not bool(delivery.download_url) and bool(delivery.gzipped_url)))
    for split in delivery.splits:
        url = split.url or split.gzipped_url
        if url:
            files.append(FileRef(id=secrets.token_urlsafe(8), name=f"{package}-{version_code}-{_slug(split.name)}.apk", kind="split", size=split.size or split.gzipped_size, sha256=split.sha256, url=url, cookies=list(delivery.cookies), gzipped=not bool(split.url) and bool(split.gzipped_url)))
    for index, extra in enumerate(delivery.additional_files):
        if not extra.url:
            continue
        if extra.is_asset_pack:
            name, kind = f"{package}-{version_code}-asset-{index + 1}.apk", "asset"
        else:
            name, kind = f"{extra.type_label}.{extra.version_code or version_code}.{package}.obb", "obb"
        files.append(FileRef(id=secrets.token_urlsafe(8), name=name, kind=kind, size=extra.size, url=extra.url, cookies=list(extra.cookies or delivery.cookies), gzipped=extra.gzipped))
    if delivery.dex_metadata and delivery.dex_metadata.url:
        files.append(FileRef(id=secrets.token_urlsafe(8), name=f"{package}-{version_code}.dm", kind="dm", size=delivery.dex_metadata.size, sha256=delivery.dex_metadata.sha256, url=delivery.dex_metadata.url, cookies=list(delivery.cookies)))
    return files


def _variant_signature(files: Iterable[FileRef], version_code: int) -> str:
    parts = [str(version_code)] + [f"{f.kind}|{f.name}|{f.size}|{f.sha256}|{f.sha1}" for f in sorted(files, key=lambda item: (item.kind, item.name))]
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def _delivery_with_auth(package: str, auth: dict, locales: list[str], requested_version: int | None) -> tuple[play_api.AppDetails, int, play_api.DeliveryResult]:
    details = play_api.get_details(package, auth)
    version_code = requested_version or details.version_code
    if not version_code:
        raise play_api.PlayAPIError("Google Play did not return a version code")
    delivery_token = play_api.purchase(package, version_code, auth)
    return details, version_code, play_api.get_delivery(package, version_code, auth, delivery_token=delivery_token, locales=locales)


def _candidate_profiles(arch: str, deep_scan: bool) -> list[tuple[str, dict]]:
    if deep_scan:
        return get_priority_profiles(arch)[:MAX_SCAN_PROFILES]
    candidates = get_priority_profiles(arch)[:1] + get_compat_profiles(arch)[:6] + get_discovery_profiles(arch)
    out: list[tuple[str, dict]] = []
    seen: set[str] = set()
    for key, profile in candidates:
        if key not in seen:
            out.append((key, profile))
            seen.add(key)
    return out


def _resolve_arch(package: str, arch: str, locales: list[str], requested_version: int | None, deep_scan: bool, force_refresh: bool) -> tuple[list[Variant], play_api.AppDetails | None, list[str]]:
    variants: list[Variant] = []
    errors: list[str] = []
    seen_payloads: set[str] = set()
    representative: play_api.AppDetails | None = None

    if not deep_scan:
        try:
            auth = _require_auth(arch, force_refresh=force_refresh)
            details, vc, delivery = _delivery_with_auth(package, auth, locales, requested_version)
            representative = details
            files = _files_from_delivery(package, vc, delivery)
            seen_payloads.add(_variant_signature(files, vc))
            dip = auth.get("deviceInfoProvider", {})
            variants.append(Variant(id=secrets.token_urlsafe(8), arch=arch, profile="auto", device=dip.get("model") or dip.get("device") or f"Auto {arch}", sdk=_safe_int(dip.get("sdkVersion")), density=_safe_int(dip.get("screenDensity")), abis=dip.get("platforms") or arch, locales=locales, version_code=vc, version_name=details.version_string, files=files))
            return variants, representative, errors
        except (play_api.AppNotSupportedError, play_api.AppNotAvailableError) as exc:
            errors.append(f"auto: {exc}")
        except play_api.AuthExpiredError:
            try:
                auth = _require_auth(arch, force_refresh=True)
                details, vc, delivery = _delivery_with_auth(package, auth, locales, requested_version)
                representative = details
                files = _files_from_delivery(package, vc, delivery)
                variants.append(Variant(id=secrets.token_urlsafe(8), arch=arch, profile="auto-refreshed", device=f"Auto {arch}", sdk=0, density=0, abis=arch, locales=locales, version_code=vc, version_name=details.version_string, files=files))
                return variants, representative, errors
            except Exception as exc:
                errors.append(f"refresh: {exc}")
        except play_api.AppNotPurchasedError as exc:
            raise HTTPException(403, str(exc)) from exc
        except Exception as exc:
            errors.append(f"auto: {exc}")

    for profile_key, profile in _candidate_profiles(arch, deep_scan):
        try:
            auth = fetch_token_for_profile(profile, dispenser_url=DISPENSER_URL, email=ACCOUNT_EMAIL)
            if not auth:
                errors.append(f"{profile_key}: token unavailable")
                continue
            details, vc, delivery = _delivery_with_auth(package, auth, locales, requested_version)
            representative = representative or details
            files = _files_from_delivery(package, vc, delivery)
            if not files:
                continue
            sig = _variant_signature(files, vc)
            if sig in seen_payloads:
                continue
            seen_payloads.add(sig)
            device, sdk, density, abis = _profile_meta(profile_key, profile, arch)
            variants.append(Variant(id=secrets.token_urlsafe(8), arch=arch, profile=profile_key, device=device, sdk=sdk, density=density, abis=abis, locales=locales, version_code=vc, version_name=details.version_string, files=files))
            if not deep_scan:
                break
        except play_api.AppNotPurchasedError as exc:
            raise HTTPException(403, str(exc)) from exc
        except Exception as exc:
            errors.append(f"{profile_key}: {exc}")
    return variants, representative, errors


@app.get("/health")
def health() -> dict:
    return {"ok": True, "name": APP_NAME, "version": APP_VERSION}


@app.get("/api/status")
def status() -> dict:
    return {"ok": True, "linked": _linked(), "dispenser": dispenser_base(DISPENSER_URL), "architectures": list(ARCHES), "mergeAvailable": APKEDITOR_JAR.is_file() and shutil.which("java") is not None and shutil.which("jarsigner") is not None, "deepScanMaxProfiles": MAX_SCAN_PROFILES, "manifestTtlSeconds": MANIFEST_TTL}


@app.get("/api/search", response_model=list[SearchResult])
def search(q: str = Query(min_length=2, max_length=120), limit: int = Query(12, ge=1, le=30)) -> list[dict]:
    auth = _require_auth("arm64")
    try:
        return play_api.search_apps(q.strip(), auth, limit=limit)
    except play_api.AuthExpiredError:
        return play_api.search_apps(q.strip(), _require_auth("arm64", force_refresh=True), limit=limit)
    except Exception as exc:
        raise HTTPException(502, f"Google Play search failed: {exc}") from exc


@app.get("/api/app/{package}")
def app_info(package: str, arch: Literal["arm64", "armv7", "x86_64", "x86", "tv"] = "arm64") -> dict:
    package = _safe_package(package)
    auth = _require_auth(arch)
    try:
        details, splits = play_api.get_details(package, auth), play_api.list_splits(package, auth)
    except play_api.AuthExpiredError:
        auth = _require_auth(arch, force_refresh=True)
        details, splits = play_api.get_details(package, auth), play_api.list_splits(package, auth)
    except Exception as exc:
        raise HTTPException(502, f"Google Play details failed: {exc}") from exc
    return {"package": details.package, "title": details.title, "developer": details.developer, "versionName": details.version_string, "versionCode": details.version_code, "rating": details.rating, "downloads": details.downloads, "playUrl": details.play_url, "knownSplits": splits}


@app.post("/api/resolve")
def resolve(request: ResolveRequest) -> dict:
    if not _linked():
        raise HTTPException(503, "Backend is not linked. Run `docker compose exec backend gplaydl link` once, or set GPLAYDL_API_KEY.")
    all_variants: list[Variant] = []
    representative: play_api.AppDetails | None = None
    errors: dict[str, list[str]] = {}
    for arch in request.architectures:
        variants, details, arch_errors = _resolve_arch(request.package, arch, request.locales, request.versionCode, request.deepScan, request.forceRefresh)
        all_variants.extend(variants)
        representative = representative or details
        if arch_errors:
            errors[arch] = arch_errors[-8:]
    if not all_variants:
        hint = "; ".join(f"{arch}: {vals[-1]}" for arch, vals in errors.items() if vals)
        raise HTTPException(404, f"Google Play returned no downloadable variant. {hint}".strip())
    manifest = Manifest(id=secrets.token_urlsafe(18), package=request.package, title=representative.title if representative else request.package, developer=representative.developer if representative else "", created_at=time.time(), variants=all_variants)
    _cleanup_cache()
    with _CACHE_LOCK:
        _CACHE[manifest.id] = manifest
    payload = manifest.public()
    payload["diagnostics"] = errors
    return payload


def _find_file(manifest: Manifest, file_id: str) -> FileRef:
    for variant in manifest.variants:
        for file_ref in variant.files:
            if file_ref.id == file_id:
                return file_ref
    raise HTTPException(404, "File not found in manifest")


def _cookie_header(cookies: list[dict]) -> str:
    return "; ".join(f"{c.get('name', '')}={c.get('value', '')}" for c in cookies if c.get("name"))


def _stream_file(file_ref: FileRef):
    timeout = httpx.Timeout(connect=15.0, read=300.0, write=30.0, pool=30.0)
    headers: dict[str, str] = {}
    cookie = _cookie_header(file_ref.cookies)
    if cookie:
        headers["Cookie"] = cookie
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", file_ref.url, headers=headers) as response:
            response.raise_for_status()
            if file_ref.gzipped:
                decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16)
                for chunk in response.iter_bytes(64 * 1024):
                    out = decompressor.decompress(chunk)
                    if out:
                        yield out
                tail = decompressor.flush()
                if tail:
                    yield tail
            else:
                yield from response.iter_bytes(64 * 1024)


@app.get("/api/file/{manifest_id}/{file_id}")
def download_file(manifest_id: str, file_id: str):
    file_ref = _find_file(_get_manifest(manifest_id), file_id)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_ref.name)}", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"}
    if file_ref.size and not file_ref.gzipped:
        headers["Content-Length"] = str(file_ref.size)
    media_type = "application/vnd.android.package-archive" if file_ref.name.endswith(".apk") else "application/octet-stream"
    return StreamingResponse(_stream_file(file_ref), media_type=media_type, headers=headers)


def _variant_by_id(manifest: Manifest, variant_id: str) -> Variant:
    for variant in manifest.variants:
        if variant.id == variant_id:
            return variant
    raise HTTPException(404, "Variant not found")


def _download_specs(files: list[FileRef], directory: Path) -> list[DownloadSpec]:
    return [DownloadSpec(url=item.url, dest=directory / item.name, cookies=item.cookies, label=item.name, gzipped=item.gzipped, sha256=item.sha256, sha1=item.sha1) for item in files]


def _download_files(files: list[FileRef], directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    download_batch(_download_specs(files, directory))


def _write_sai_meta(zip_file: ZipFile, manifest: Manifest, variant: Variant, apk_size: int) -> None:
    now_ms = int(time.time() * 1000)
    meta_v1 = {"export_timestamp": now_ms, "label": manifest.title, "package": manifest.package, "version_code": variant.version_code, "version_name": variant.version_name}
    meta_v2 = {**meta_v1, "split_apk": len([f for f in variant.files if f.kind in ("base", "split")]) > 1, "meta_version": 2, "min_sdk": 0, "target_sdk": 0, "backup_components": [{"type": "apk_files", "size": apk_size}]}
    zip_file.writestr("meta.sai_v1.json", json.dumps(meta_v1, ensure_ascii=False, separators=(",", ":")))
    zip_file.writestr("meta.sai_v2.json", json.dumps(meta_v2, ensure_ascii=False, separators=(",", ":")))


def _zip_variant(manifest: Manifest, variant: Variant, source: Path, output: Path, apks_only: bool) -> None:
    selected = [f for f in variant.files if f.name.endswith(".apk")] if apks_only else variant.files
    with ZipFile(output, "w", ZIP_DEFLATED, allowZip64=True) as zf:
        total_apk = 0
        for item in selected:
            path = source / item.name
            if path.exists():
                zf.write(path, arcname=item.name)
                if item.name.endswith(".apk"):
                    total_apk += path.stat().st_size
        if apks_only:
            _write_sai_meta(zf, manifest, variant, total_apk)


def _zip_all(manifest: Manifest, root: Path, output: Path) -> None:
    with ZipFile(output, "w", ZIP_DEFLATED, allowZip64=True) as zf:
        zf.writestr("manifest.json", json.dumps(manifest.public(), ensure_ascii=False, indent=2))
        for variant in manifest.variants:
            dirname = f"{variant.arch}-{variant.id}"
            directory = root / dirname
            for item in variant.files:
                path = directory / item.name
                if path.exists():
                    zf.write(path, arcname=f"{dirname}/{item.name}")


def _ensure_merge_key() -> None:
    if MERGE_KEYSTORE.exists():
        return
    MERGE_KEYSTORE.parent.mkdir(parents=True, exist_ok=True)
    keytool = shutil.which("keytool")
    if not keytool:
        raise RuntimeError("keytool is not installed")
    subprocess.run([keytool, "-genkeypair", "-noprompt", "-storetype", "PKCS12", "-keystore", str(MERGE_KEYSTORE), "-storepass", MERGE_STOREPASS, "-keypass", MERGE_STOREPASS, "-alias", MERGE_ALIAS, "-keyalg", "RSA", "-keysize", "2048", "-validity", "3650", "-dname", "CN=Google Play Downloader Local Merge,O=Local,C=XX"], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60)


def _merge_and_sign(files: list[FileRef], source: Path, output: Path) -> None:
    if not APKEDITOR_JAR.is_file():
        raise HTTPException(503, "APKEditor is not installed in the backend image")
    java, jarsigner = shutil.which("java"), shutil.which("jarsigner")
    if not java or not jarsigner:
        raise HTTPException(503, "Java/JDK signing tools are not installed")
    merge_input = source / "merge-input"
    merge_input.mkdir(exist_ok=True)
    apk_count = 0
    for item in files:
        if item.kind in ("base", "split") and item.name.endswith(".apk"):
            src = source / item.name
            if src.exists():
                shutil.copy2(src, merge_input / item.name)
                apk_count += 1
    if apk_count == 0:
        raise HTTPException(422, "No APK files are available for merge")
    if apk_count == 1:
        shutil.copy2(next(merge_input.glob("*.apk")), output)
        return
    proc = subprocess.run([java, "-Xmx2g", "-jar", str(APKEDITOR_JAR), "m", "-clean-meta", "-f", "-i", str(merge_input), "-o", str(output)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=300)
    if proc.returncode != 0 or not output.exists():
        raise HTTPException(500, f"APKEditor merge failed: {proc.stdout[-1800:]}")
    _ensure_merge_key()
    proc = subprocess.run([jarsigner, "-keystore", str(MERGE_KEYSTORE), "-storepass", MERGE_STOREPASS, "-keypass", MERGE_STOREPASS, "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", str(output), MERGE_ALIAS], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=120)
    if proc.returncode != 0:
        raise HTTPException(500, f"Merged APK signing failed: {proc.stdout[-1800:]}")


@app.get("/api/archive/{manifest_id}")
def archive(manifest_id: str, background_tasks: BackgroundTasks, variant: str = Query("all"), format: Literal["zip", "apks", "merged"] = Query("zip")):
    manifest = _get_manifest(manifest_id)
    work = Path(tempfile.mkdtemp(prefix="play-downloader-"))
    background_tasks.add_task(shutil.rmtree, work, True)
    try:
        if variant == "all":
            if format != "zip":
                raise HTTPException(422, "APKS and merged APK require a single device variant")
            for item in manifest.variants:
                _download_files(item.files, work / f"{item.arch}-{item.id}")
            output = work / f"{manifest.package}-all-variants.zip"
            _zip_all(manifest, work, output)
            return FileResponse(output, filename=output.name, media_type="application/zip", background=background_tasks)
        selected = _variant_by_id(manifest, variant)
        source = work / "files"
        _download_files(selected.files, source)
        if format == "zip":
            output = work / f"{manifest.package}-{selected.version_code}-{selected.arch}.zip"
            _zip_variant(manifest, selected, source, output, apks_only=False)
            media_type = "application/zip"
        elif format == "apks":
            output = work / f"{manifest.package}-{selected.version_code}-{selected.arch}.apks"
            _zip_variant(manifest, selected, source, output, apks_only=True)
            media_type = "application/zip"
        else:
            output = work / f"{manifest.package}-{selected.version_code}-{selected.arch}-merged.apk"
            _merge_and_sign(selected.files, source, output)
            media_type = "application/vnd.android.package-archive"
        return FileResponse(output, filename=output.name, media_type=media_type, background=background_tasks)
    except HTTPException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(502, f"Archive generation failed: {exc}") from exc
