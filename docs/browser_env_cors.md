# Limitations From The Browser Environment: CORS Issue

The plugin is developed for the browser environment. The "fake" browser behind the scenes also follows the CORS policy.

[MDN has a doc about CORS.](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

1. From Obsidian desktop >= 0.13.25 or mobile >= 1.1.1, Obsidian [provides a new API `requiestUrl`](https://forum.obsidian.md/t/obsidian-release-v0-13-25-insider-build/32701), that allows the plugin to fully bypass the CORS issue. This API is available in all current Obsidian releases (desktop and mobile).

2. For older Obsidian versions (desktop < 0.13.25 or mobile < 1.1.1), you need to configure the server side to return the header `Access-Control-Allow-Origin` allowing the origins `app://obsidian.md` and `capacitor://localhost` and `http://localhost`.

   Example configurations:

   - [Amazon S3](./s3_cors_configure.md)
   - [Apache](./apache_cors_configure.md) ([contributed by community](https://github.com/remotely-save/remotely-save/pull/31))
