import { CONTAINER_VERSION } from '../version';

/**
 * The `.opsim` container: 5 magic bytes ("OPSIM"), 1 version byte, then a gzip stream of UTF-8
 * JSON. The same bytes are stored in IndexedDB and written to exported files, so an export is
 * simply the stored save.
 *
 * Compression uses the browser's built-in CompressionStream/DecompressionStream (also available
 * in Node 18+ and in workers), so there is no compression dependency.
 *
 * Imports are untrusted input: both the file size and the decompressed size are capped, so a tiny
 * crafted file cannot expand to gigabytes (a "zip bomb").
 */

const MAGIC = [0x4f, 0x50, 0x53, 0x49, 0x4d]; // "OPSIM"
export const HEADER_LENGTH = MAGIC.length + 1;

export type SaveErrorCode =
  | 'not-opsim'
  | 'unsupported-container'
  | 'too-large'
  | 'corrupt'
  | 'checksum'
  | 'invalid'
  | 'version'
  | 'slot';

export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

export interface ContainerLimits {
  maxCompressedBytes: number;
  maxDecompressedBytes: number;
}

async function run(
  input: Uint8Array,
  transform: CompressionStream | DecompressionStream,
  maxOutputBytes: number,
  onOverflow: () => SaveError,
  onFailure: (cause: unknown) => SaveError,
): Promise<Uint8Array> {
  const source = new Blob([input as Uint8Array<ArrayBuffer>]).stream();
  const reader = source.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOutputBytes) {
        await reader.cancel();
        throw onOverflow();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw onFailure(error);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** JSON text -> header + gzip bytes. */
export async function encodeContainer(json: string, limits: ContainerLimits): Promise<Uint8Array> {
  const text = new TextEncoder().encode(json);
  if (text.byteLength > limits.maxDecompressedBytes) {
    throw new SaveError(
      'too-large',
      `The save is ${text.byteLength} bytes of JSON, over the ${limits.maxDecompressedBytes} byte limit`,
    );
  }
  const gz = await run(
    text,
    new CompressionStream('gzip'),
    limits.maxDecompressedBytes,
    () => new SaveError('too-large', 'The compressed save is unexpectedly large'),
    (cause) => new SaveError('corrupt', `Compression failed: ${String(cause)}`),
  );
  const out = new Uint8Array(HEADER_LENGTH + gz.byteLength);
  out.set(MAGIC, 0);
  out[MAGIC.length] = CONTAINER_VERSION;
  out.set(gz, HEADER_LENGTH);
  return out;
}

/** Header + gzip bytes -> JSON text. Throws SaveError with a code the UI can explain. */
export async function decodeContainer(bytes: Uint8Array, limits: ContainerLimits): Promise<string> {
  if (bytes.byteLength > limits.maxCompressedBytes) {
    throw new SaveError(
      'too-large',
      `The file is ${bytes.byteLength} bytes, over the ${limits.maxCompressedBytes} byte limit`,
    );
  }
  if (bytes.byteLength < HEADER_LENGTH || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new SaveError('not-opsim', 'This is not an .opsim save file');
  }
  const version = bytes[MAGIC.length];
  if (version !== CONTAINER_VERSION) {
    throw new SaveError(
      'unsupported-container',
      `This save uses container format ${version}, but this version of the game reads format ${CONTAINER_VERSION}`,
    );
  }
  const raw = await run(
    bytes.subarray(HEADER_LENGTH),
    new DecompressionStream('gzip'),
    limits.maxDecompressedBytes,
    () =>
      new SaveError(
        'too-large',
        `The save expands past ${limits.maxDecompressedBytes} bytes and was rejected`,
      ),
    () => new SaveError('corrupt', 'The save file is damaged (it could not be decompressed)'),
  );
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new SaveError('corrupt', 'The save file is damaged (its contents are not valid text)');
  }
}
