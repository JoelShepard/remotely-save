# Services connectability

Here is an overview of the connectability ("connectable" or "not connectable") to some services by this plugin.

The plugin works under the browser environment in Obsidian, so CORS is an issue. Obsidian starts to provide a rich API `requestUrl` for desktop version >= 0.13.25, mobile >= 1.1.1 to bypass the CORS issue.

The list is for information purposes only.

| Service | Connectable | by S3 | by WebDAV | by Webdis |
| ------ | ------ | ------ | ------ | ------ |
| Amazon S3 | Yes | Yes | | |
| Tencent Cloud - Cloud Object Storage (COS) | Yes | Yes | | |
| Alibaba Cloud - Object Storage Service | Yes | Yes | | |
| Backblaze B2 Cloud Storage | Yes | Yes | | |
| [Wasabi](https://wasabi.com) | ? | ? | | |
| [filebase](https://filebase.com/) | Yes | Yes | | |
| QingStor 青云 | ? | ? | | |
| [MinIO](https://min.io/) | Yes | Yes | | |
| [WsgiDAV](https://github.com/mar10/wsgidav) | Yes | | Yes | |
| [Nginx `ngx_http_dav_module`](http://nginx.org/en/docs/http/ngx_http_dav_module.html) | Yes | | Yes | |
| NextCloud | Yes | | Yes | |
| OwnCloud | Yes? | | Yes? | |
| Seafile | Yes | | Yes | |
| `rclone serve webdav` | Yes | | Yes | |
| [Nutstore](https://www.jianguoyun.com/) | Yes (partially) | | Yes (partially) | |
| [TeraCLOUD](https://teracloud.jp/en/) | Yes | | Yes | |
| Webdis (Redis HTTP) | Yes | | | Yes |
| FTP / FTPS | Never | | | |
| SFTP | Never | | | |
| Jottacloud | No | | | |
| Mega | Never | | | |
| Git | Never | | | |
