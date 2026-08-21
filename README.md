<div align="center">

# Google Play APK Downloader

**Web UI for downloading original Google Play delivery files: base APK, split APKs, APKS, OBB/PAD assets, DEX metadata, architecture/device variants and a locally re-signed merged APK.**

Intended GitHub Pages URL: `https://basil-as.github.io/google-play-downloader/`

</div>

## What it does

This project is the Google Play counterpart of `Basil-AS/rustore-downloader`, but Google Play delivery is fundamentally different from RuStore: App Bundle applications are normally served as a **base APK + device-targeted configuration splits** rather than one universal APK.

The project therefore has two parts:

- **GitHub Pages frontend** — static HTML/CSS/JS, no Google credentials in the browser;
- **backend API** — authenticates a device profile, calls Google Play FDFE `details → purchase → delivery`, then streams files from Google's CDN.

### Download modes

- original `base.apk` equivalent;
- all split APKs returned for the selected device profile;
- OBB expansion files and Play Asset Delivery APKs where returned;
- optional `.dm` DEX metadata when Play exposes it;
- SAI-compatible `.apks` archive with SAI metadata;
- ZIP containing every original file for a variant;
- ZIP containing every resolved architecture/profile variant;
- merged standalone APK using APKEditor (reconstructed and **locally re-signed**).

### Device / architecture coverage

- `arm64` → `arm64-v8a`;
- `armv7` → `armeabi-v7a`;
- `x86_64`;
- `x86`;
- Android TV / Google TV profiles;
- extra language splits via locale list;
- explicit historical `versionCode` when Google still serves it;
- **Deep Scan**: iterates the bundled device profiles for each selected architecture and deduplicates identical delivery manifests. This can reveal different ABI, density, SDK/form-factor targeted deliveries.

There is no API that guarantees "every APK Google has ever generated". Region, account entitlements, device compatibility and current Play retention all affect what the server returns. Historical versions work only while Google still serves the requested `versionCode` to at least one compatible profile.

## Why a backend is required

GitHub Pages cannot safely perform Google Play device authentication. The backend keeps the gplaydl pairing key server-side and never returns Play auth tokens or CDN cookies to the frontend.

The backend uses the actively maintained [`rehmatworks/gplaydl`](https://github.com/rehmatworks/gplaydl) Play protocol implementation, pinned to commit `7c3d87f20a5f61f6cfa7446683bb4c698bfa2396`. It talks directly to Google's FDFE endpoints and validates downloaded APKs against hashes declared by Play when archives are generated.

> **Account warning:** this is an unofficial Google Play client. Google may rate-limit, challenge, restrict or lock accounts used with unofficial clients. Use a separate account without payment methods rather than a primary Google account.

## Quick deployment

### 1. Backend

```bash
git clone https://github.com/Basil-AS/google-play-downloader.git
cd google-play-downloader
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set at least the Pages origin:

```env
ALLOWED_ORIGINS=https://Basil-AS.github.io
MERGE_STOREPASS=a-long-random-local-password
```

Start it:

```bash
docker compose up -d --build
```

Pair a spare Google account once:

```bash
docker compose exec backend gplaydl link
```

The pairing key is stored under `./data/gplaydl/` and survives container rebuilds. Alternatively set `GPLAYDL_API_KEY` in `backend/.env` for a non-interactive deployment.

Check:

```bash
curl http://127.0.0.1:8080/api/status
```

In production, put Caddy/nginx/Traefik in front of `127.0.0.1:8080` and expose it only over HTTPS.

### 2. GitHub Pages

The workflow `.github/workflows/pages.yml` publishes only:

- `index.html`;
- `assets/`;
- `.nojekyll`.

In the repository settings select **Pages → Source → GitHub Actions** once. Then pushes to `main` deploy the frontend automatically.

Open the site, press **Backend**, enter the HTTPS API URL, and press **Save**. The URL is stored only in browser `localStorage`. You can also open the page once with `?api=https://play-api.example.com`.

## Backend API

| Endpoint | Purpose |
|---|---|
| `GET /health` | process health |
| `GET /api/status` | pairing/merge capability status |
| `GET /api/search?q=...` | Google Play search |
| `GET /api/app/{package}` | current metadata + known split names |
| `POST /api/resolve` | resolve one or many architecture/device deliveries |
| `GET /api/file/{manifest}/{file}` | stream one original Play file |
| `GET /api/archive/{manifest}?variant=...&format=zip` | original files ZIP |
| `...&format=apks` | SAI-compatible APKS |
| `...&format=merged` | APKEditor merged + locally signed APK |
| `...variant=all&format=zip` | all resolved variants |

Example resolve:

```json
{
  "package": "org.videolan.vlc",
  "architectures": ["arm64", "armv7", "x86_64", "x86"],
  "locales": ["ru", "en-US"],
  "versionCode": null,
  "deepScan": false,
  "forceRefresh": false
}
```

## APK vs APKS

For an App Bundle application, **base APK alone is usually not installable** because native libraries/resources may live in configuration splits. The original Google-signed form is the set of base + required splits and can be installed with `adb install-multiple` or a split installer.

The `.apks` output is a ZIP/APKS container with the APK files and `meta.sai_v1.json`/`meta.sai_v2.json` metadata compatible with the format documented by SAI.

The merged APK is different: APKEditor combines base and splits into one package and the backend signs the result with a local key stored in `/data/merge-keystore.p12`. Consequently:

- it is **not** byte-for-byte original;
- it does **not** keep the Google Play signing certificate;
- it cannot update over the original Play-signed install;
- signature checks / Play Integrity / some dynamic delivery apps can reject it.

Use APKS/original splits when signature fidelity matters.

## Security notes

- Never put `GPLAYDL_API_KEY`, Google credentials, auth tokens or merge keystore passwords in GitHub Pages JS.
- Restrict `ALLOWED_ORIGINS` to your Pages origin in production.
- CDN URLs, cookies and Play tokens are kept in an in-memory backend manifest cache and expire by default after 45 minutes.
- The backend uses one uvicorn worker because its manifest cache is process-local. Put a reverse proxy in front rather than increasing workers unless you replace the cache with Redis or another shared store.
- The merged-APK signing key is local to the backend and should be persisted if you need repeatable signatures across merges.

## Verification

```bash
python -m py_compile backend/app.py
node --check assets/app.js
docker compose config
```

The GitHub Actions verification workflow runs static checks on every push and pull request.

## Credits / licenses

This repository retains the MIT lineage of `Basil-AS/rustore-downloader` and uses the MIT-licensed `rehmatworks/gplaydl` package as a runtime dependency. APK merging uses [REAndroid/APKEditor](https://github.com/REAndroid/APKEditor) when available; see the upstream project for its license and notices.

The project is not affiliated with Google, Google Play, Aurora Store, SAI or application developers/publishers.
