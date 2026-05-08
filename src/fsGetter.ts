import type { RemotelySavePluginSettings } from "./baseTypes";
import type { FakeFs } from "./fsAll";
import { FakeFsS3 } from "./fsS3";
import { FakeFsWebdav } from "./fsWebdav";

export function getClient(
  settings: RemotelySavePluginSettings,
  vaultName: string,
  saveUpdatedConfigFunc: () => Promise<any>
): FakeFs {
  switch (settings.serviceType) {
    case "s3":
      return new FakeFsS3(settings.s3);
    case "webdav":
      return new FakeFsWebdav(
        settings.webdav,
        vaultName,
        saveUpdatedConfigFunc
      );
    default:
      throw Error(`cannot init client for serviceType=${settings.serviceType}`);
  }
}
