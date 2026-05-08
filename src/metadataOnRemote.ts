import isEqual from "lodash/isEqual";
import { base64url } from "rfc4648";
import { reverseString } from "./misc";

const DEFAULT_README_FOR_METADATAONREMOTE =
  "Do NOT edit or delete the file manually. This file is for the plugin remote-sync to store some necessary meta data on the remote services. Its content is slightly obfuscated.";

const DEFAULT_VERSION_FOR_METADATAONREMOTE = "20220220";

export const DEFAULT_FILE_NAME_FOR_METADATAONREMOTE =
  "_remote-sync-metadata-on-remote.json";

export const DEFAULT_FILE_NAME_FOR_METADATAONREMOTE2 =
  "_remote-sync-metadata-on-remote.bin";

export const METADATA_FILE_PATH = "_remote_sync/metadata.json";

export const DELETION_CLEANUP_AGE_MS = 15 * 24 * 60 * 60 * 1000;

export interface DeletionOnRemote {
  key: string;
  actionWhen: number;
}

export interface MetadataOnRemote {
  version?: string;
  generatedWhen?: number;
  deletions?: DeletionOnRemote[];
}

export const isEqualMetadataOnRemote = (
  a: MetadataOnRemote | undefined,
  b: MetadataOnRemote | undefined
) => {
  const m1 = a === undefined ? { deletions: [] } : a;
  const m2 = b === undefined ? { deletions: [] } : b;

  // we only need to compare deletions
  const d1 = m1.deletions === undefined ? [] : m1.deletions;
  const d2 = m2.deletions === undefined ? [] : m2.deletions;
  return isEqual(d1, d2);
};

export const serializeMetadataOnRemote = (x: MetadataOnRemote) => {
  const y = x;

  if (y["version"] === undefined) {
    y["version"] = DEFAULT_VERSION_FOR_METADATAONREMOTE;
  }
  if (y["generatedWhen"] === undefined) {
    y["generatedWhen"] = Date.now();
  }
  if (y["deletions"] === undefined) {
    y["deletions"] = [];
  }

  const z = {
    readme: DEFAULT_README_FOR_METADATAONREMOTE,
    d: reverseString(
      base64url.stringify(Buffer.from(JSON.stringify(x), "utf-8"), {
        pad: false,
      })
    ),
  };

  return JSON.stringify(z, null, 2);
};

export const deserializeMetadataOnRemote = (x: string | ArrayBuffer) => {
  let y1 = "";
  if (typeof x === "string") {
    y1 = x;
  } else {
    y1 = new TextDecoder().decode(x);
  }

  let y2: any;
  try {
    y2 = JSON.parse(y1);
  } catch (e) {
    throw new Error(
      `invalid remote meta data file with first few chars: ${y1.slice(0, 5)}`
    );
  }

  if (!("readme" in y2 && "d" in y2)) {
    throw new Error(
      'invalid remote meta data file (no "readme" or "d" fields)!'
    );
  }

  let y3: string;
  try {
    y3 = (
      base64url.parse(reverseString(y2["d"]), {
        out: Buffer.allocUnsafe as any,
        loose: true,
      }) as Buffer
    ).toString("utf-8");
  } catch (e) {
    throw new Error('invalid remote meta data file (invalid "d" field)!');
  }

  let y4: MetadataOnRemote;
  try {
    y4 = JSON.parse(y3) as MetadataOnRemote;
  } catch (e) {
    throw new Error(
      `invalid remote meta data file with \"d\" field with first few chars: ${y3.slice(
        0,
        5
      )}`
    );
  }
  return y4;
};

export const addDeletionToMetadata = (
  meta: MetadataOnRemote,
  key: string,
  actionWhen?: number
): MetadataOnRemote => {
  const deletions = meta.deletions ?? [];
  const existing = deletions.findIndex((d) => d.key === key);
  const entry: DeletionOnRemote = { key, actionWhen: actionWhen ?? Date.now() };
  if (existing >= 0) {
    deletions[existing] = entry;
  } else {
    deletions.push(entry);
  }
  return { ...meta, deletions, generatedWhen: Date.now() };
};

export const removeDeletionsFromMetadata = (
  meta: MetadataOnRemote,
  keys: string[]
): MetadataOnRemote => {
  const deletions = (meta.deletions ?? []).filter((d) => !keys.includes(d.key));
  return { ...meta, deletions, generatedWhen: Date.now() };
};

export const cleanOldDeletions = (
  meta: MetadataOnRemote,
  maxAgeMs: number = DELETION_CLEANUP_AGE_MS
): MetadataOnRemote => {
  const cutoff = Date.now() - maxAgeMs;
  const deletions = (meta.deletions ?? []).filter((d) => d.actionWhen > cutoff);
  return { ...meta, deletions, generatedWhen: Date.now() };
};
