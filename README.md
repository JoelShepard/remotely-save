# Remotely Save

English | [中文](./README.zh-cn.md)

A sync plugin for [Obsidian](https://obsidian.md). Sync your vault across devices using cloud services.

[![GitHub Repo stars](https://img.shields.io/github/stars/fyears/remotely-save?style=social)](https://github.com/fyears/remotely-save)
[![BuildCI](https://github.com/fyears/remotely-save/actions/workflows/auto-build.yml/badge.svg)](https://github.com/fyears/remotely-save/actions/workflows/auto-build.yml)
[![downloads](https://img.shields.io/github/downloads-pre/remotely-save/remotely-save/latest/main.js?sort=semver)](https://github.com/fyears/remotely-save/releases)

## Disclaimer

- **This is NOT the [official sync service](https://obsidian.md/sync) provided by Obsidian.**

## Caution

**ALWAYS backup your vault before using this plugin.**

## Features

- **Multiple cloud backends**: Amazon S3 / S3-compatible (Cloudflare R2, BackBlaze B2, MinIO, ...), Dropbox, OneDrive for personal, WebDAV (NextCloud, Synology, ...), Webdis
- **Mobile support** — sync across mobile and desktop devices
- **End-to-end encryption** using openssl / rclone crypt format
- **Scheduled auto sync** and manual sync via ribbon icon or command palette
- **Sync on save**
- **Skip large files** and **skip paths** by custom regex
- **Conflict detection and handling**
- **Minimal intrusive design** — reads and writes timestamps and content only
- **Source available** under Apache 2.0

See [all supported services](./docs/services_connectable_or_not.md) for details.

## Limitations

- Cloud services cost money. Monitor your usage and pricing.
- The plugin runs in Obsidian's browser environment — see [technical details](./docs/browser_env.md).
- Protect your `data.json` — it contains sensitive auth info. Do not share it or commit it to version control.
- Mobile has performance issues syncing files >= 50 MB. Use the "Skip Large Files" option.

## Install

1. Search "Remotely Save" in Obsidian's community plugin list, or visit [obsidian.md/plugins](https://obsidian.md/plugins?id=remotely-save).
2. Alternatively, use [BRAT](https://github.com/TfTHacker/obsidian42-brat) with `remotely-save/remotely-save`.
3. Manual install: download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/fyears/remotely-save/releases).

## Usage

### S3 / S3-Compatible

Tutorials:

- [Cloudflare R2](./docs/remote_services/s3_cloudflare_r2/README.md)
- [BackBlaze B2](./docs/remote_services/s3_backblaze_b2/README.md)
- [Storj](./docs/remote_services/s3_storj_io/README.md)
- [腾讯云 COS](./docs/remote_services/s3_tencent_cloud_cos/README.zh-cn.md) / [Tencent Cloud COS](./docs/remote_services/s3_tencent_cloud_cos/README.md)
- [MinIO](./docs/remote_services/s3_minio/README.md)
- [又拍云](./docs/remote_services/s3_upyun/README.zh-cn.md)

Configure your [endpoint, region](https://docs.aws.amazon.com/general/latest/gr/s3.html), [access key id, secret key](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-your-credentials.html), and bucket name in the plugin settings. For AWS S3, set up a [policy and user](./docs/remote_services/s3_general/s3_user_policy.md). Very old versions of Obsidian need [CORS configuration](./docs/remote_services/s3_general/s3_cors_configure.md).

### Dropbox

After authorization, the plugin reads your name and email (required by Dropbox API) and syncs to `/Apps/remotely-save`. Follow the instructions in plugin settings. [Screenshots here](./docs/dropbox_review_material/README.md).

### OneDrive for personal

After authorization, the plugin syncs to `/Apps/remotely-save`. [FAQ](./docs/remote_services/onedrive/README.md).

### WebDAV

Tutorials:

- [Nextcloud](./docs/remote_services/webdav_nextcloud/README.md)
- [The Good Cloud](./docs/remote_services/webdav_thegoodcloud/README.md)
- [ownCloud](./docs/remote_services/webdav_owncloud/README.md)
- [InfiniCloud](./docs/remote_services/webdav_infinicloud_teracloud/README.md)
- [Synology](./docs/remote_services/webdav_synology_webdav_server/README.md)
- [dufs](./docs/remote_services/webdav_dufs/README.md)
- [AList](./docs/remote_services/webdav_alist/README.md)
- [坚果云](./docs/remote_services/webdav_jianguoyun/README.zh-cn.md) / [NutStore](./docs/remote_services/webdav_jianguoyun/README.md)
- [Open Media Vault](./docs/remote_services/webdav_openmediavault/README.md)
- [Nginx](./docs/remote_services/webdav_nginx/README.md)
- [Apache](./docs/remote_services/webdav_apache/README.md)
- [Caddy](./docs/remote_services/webdav_caddy/README.md)

Data syncs to a `${vaultName}` subfolder on your WebDAV server.

### Webdis

Experimental. [Tutorial](./docs/remote_services/webdis/README.md). Set up and secure your own server.

## Config Folder and Bookmarks

By default, the plugin does not sync `.obsidian` (hidden files). You can enable config folder sync in settings (experimental). Bookmarks (`.obsidian/bookmarks.json`) can be synced selectively.

## Hidden Files

Files and folders starting with `.` (dot) or `_` (underscore) are treated as hidden and not synced. You can allow `_` prefixes and `.obsidian` in settings.

## Debug

See [how to debug](./docs/how_to_debug/README.md). Enable the [profiler](./docs/check_performance/README.md) for performance analysis.

## Import/Export Settings via QR Code

See [here](./docs/import_export_some_settings.md).

## Questions, Suggestions, Bugs

- Questions & suggestions: [GitHub Discussions](https://github.com/remotely-save/remotely-save/discussions)
- Bugs: [GitHub Issues](https://github.com/remotely-save/remotely-save/issues)

## Download History

Unofficial stats: [Obsidian Stats](https://www.moritzjung.dev/obsidian-stats/plugins/remotely-save/#downloads)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=remotely-save/remotely-save&type=Date)](https://star-history.com/#remotely-save/remotely-save&Date)
