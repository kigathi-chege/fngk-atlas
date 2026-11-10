import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Sealed = { ciphertext: string; iv: string; tag: string };

/**
 * One secret encrypted at rest (AES-256-GCM) for the local Atlas service. The encryption key is a per-installation,
 * owner-only file (`credentials.key`) shared by every store in the data directory; desktop hosts may supply
 * ATLAS_CREDENTIAL_KEY to bind it to an OS credential store without changing the file format. Plain metadata fields
 * can be saved next to the sealed secret (the secret itself is never returned except through secret()).
 */
export class LocalCredentialStore {
  readonly #file: string; readonly #keyFile: string; readonly #key: Buffer;
  constructor(files: { file: string; keyFile: string }) {
    this.#file = files.file; this.#keyFile = files.keyFile; this.#key = this.#loadKey();
  }
  /** Data-directory file names for a database file; ':memory:' databases use scratch names in the working directory. */
  static locate(databaseFile: string, name: string, testName: string) {
    const memory = databaseFile === ':memory:', directory = memory ? process.cwd() : dirname(databaseFile);
    return { file: join(directory, memory ? testName : name), keyFile: join(directory, memory ? '.atlas-calculator-connection.test.key' : 'credentials.key') };
  }
  #loadKey() {
    const supplied = process.env.ATLAS_CREDENTIAL_KEY;
    if (supplied) return createHash('sha256').update(supplied).digest();
    if (existsSync(this.#keyFile)) return Buffer.from(readFileSync(this.#keyFile, 'utf8').trim(), 'base64url');
    mkdirSync(dirname(this.#keyFile), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    try { writeFileSync(this.#keyFile, key.toString('base64url'), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return Buffer.from(readFileSync(this.#keyFile, 'utf8').trim(), 'base64url'); throw error; }
    chmodSync(this.#keyFile, 0o600); return key;
  }
  /** The stored record (metadata plus sealed fields), or null when absent, empty or unreadable. */
  load<T extends object>(): (T & Sealed) | null {
    try { return JSON.parse(readFileSync(this.#file, 'utf8')) as T & Sealed; } catch { return null; }
  }
  save(secret: string, metadata: Record<string, unknown> = {}) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]), tag = cipher.getAuthTag();
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    const record = { ...metadata, ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), tag: tag.toString('base64url') };
    writeFileSync(this.#file, JSON.stringify(record), { mode: 0o600 }); chmodSync(this.#file, 0o600);
  }
  /** The decrypted secret, or null when nothing is stored or it cannot be decrypted with this installation's key. */
  secret(): string | null {
    const value = this.load<object>(); if (!value) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(value.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch { return null; }
  }
  clear() { try { writeFileSync(this.#file, '', { mode: 0o600 }); } catch {} }
}
