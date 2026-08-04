import { ServerError } from "@/errors/ServerError";
import { Temporal } from "@js-temporal/polyfill";

/**
 * uuidv7s are stored as their sixteen raw bytes rather than the thirty-six character text form: less
 * than half the size, in a value that every index repeats.
 *
 * Nothing about ordering changes. SQLite compares blobs with `memcmp`, and a uuidv7 leads with a
 * big-endian millisecond timestamp, so byte order is time order -- the same order the text form
 * sorts in, since hex encoding preserves it.
 */
export namespace Uuid {
  const TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Rejects anything malformed rather than letting `Buffer.from` quietly truncate at the first bad character. */
  export function toBytes(uuid: string): Buffer {
    if (!TEXT.test(uuid)) {
      throw ServerError.malformed_uuid({ value: uuid });
    }
    return Buffer.from(uuid.replaceAll("-", ""), "hex");
  }

  /**
   * The smallest value any uuidv7 minted at `instant` could take: its millisecond stamp followed by
   * zeroes. Comparing against it turns "everything older than this" into a range on the key itself,
   * so pruning by age needs no index on the timestamp and reads no rows it does not delete.
   */
  export function lowerBoundAt(instant: Temporal.Instant): Buffer {
    const TIMESTAMP_BYTES = 6; // uuidv7 opens with a 48-bit big-endian count of milliseconds
    const bytes = Buffer.alloc(16);
    bytes.writeUIntBE(instant.epochMilliseconds, 0, TIMESTAMP_BYTES);
    return bytes;
  }

  export function fromBytes(bytes: Uint8Array): string {
    const hex = Buffer.from(bytes).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
