import * as sodium from 'sodium-native';

export interface IKeypair {
  publicKey: Buffer;
  privateKey: Buffer;
}

export class Ed {
  public makeKeypair(hash: Buffer): IKeypair {
    const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const privateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_seed_keypair(publicKey, privateKey, hash);
    return { privateKey, publicKey };
  }

  /**
   * Creates a signature based on a hash and a keypair.
   */
  public sign(hash: Buffer, keypair: IKeypair): Buffer {
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(signature, hash, keypair.privateKey);
    return signature;
  }

  /**
   * Verifies a signature based on a hash and a publicKey.
   */
  public verify(hash: Buffer, signature: Buffer, publicKey: Buffer): boolean {
    return sodium.crypto_sign_verify_detached(signature, hash, publicKey);
  }

}
