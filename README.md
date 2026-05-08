# Remotely Save

A sync plugin for [Obsidian](https://obsidian.md) that syncs your vault with cloud services.

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

## Install

1. Search "Remotely Save" in Obsidian's community plugin list.
2. Or manual install: download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/JoelShepard/remotely-save/releases).

## License

Apache 2.0
