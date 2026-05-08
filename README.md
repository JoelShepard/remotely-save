# Remote Sync

A fork of [Remotely Save](https://github.com/remotely-save/remotely-save) that syncs your Obsidian vault with cloud services.

## Supported Services

- **S3-compatible** (Amazon S3, MinIO, Backblaze B2, Wasabi, and any S3-compatible storage)
- **WebDAV** (Nextcloud, Synology, ownCloud, Seafile, and any WebDAV server)
- **Webdis** (Redis over HTTP)

## Features

- Sync by S3, WebDAV, or Webdis
- Mobile support
- End-to-end encryption (RClone Crypt / OpenSSL)
- Scheduled auto sync and manual sync
- Sync on save
- Skip large files and custom path filtering
- Conflict detection and handling
- Bidirectional, push-only, and pull-only sync directions

## Install via BRAT (recommended)

This plugin is not in the official community store (yet). Install using [BRAT](https://obsidian.md/plugins?id=obsidian42-brat):

1. Install **BRAT** from Obsidian's community plugins
2. In BRAT settings, click **Add Beta plugin**
3. Enter the repo: `JoelShepard/remote-sync`
4. Enable **Remote Sync** in the community plugins list

## Manual Install

Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/JoelShepard/remote-sync/releases).

## License

Apache 2.0
