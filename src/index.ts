import {
    verify as verifyMsg,
    create as createMsg,
} from '@substrate-system/message'
import type { SignedMessage } from '@substrate-system/message'
import {
    DEFAULT_SYMM_LENGTH,
    DEFAULT_SYMM_ALGORITHM
} from '@substrate-system/keys/constants'
import { AES } from '@substrate-system/keys/aes/index'
import { RsaKeys, encryptKeyTo } from '@substrate-system/keys/rsa'
import type { DID } from '@substrate-system/keys/rsa'
import { toString } from 'uint8arrays'
import serialize from 'json-canon'

//
// {
//     seq: 0,
//     expiration: '456',
//     recipient: 'my-identity',
//     signature: '123abc',
//     author: 'did:key:abc'
// }
//

export const ALGORITHM = DEFAULT_SYMM_ALGORITHM

export type Envelope = SignedMessage<{
    seq:number,
    expiration:number,
    recipient:string,  // the recipient's username
}>

// map of device name to encrypted key string
export type Keys = Record<string, string>

/**
 * The public keys for a single device. This is the shape returned by
 * `keys.toJson()` in `@substrate-system/keys`.
 */
export interface Device {
    DID:DID;
    publicExchangeKey:string;
}

type Content = SignedMessage<{
    from:{ username:string },
    text:string,
    mentions?:string[],
}>

export interface EncryptedContent {
    // The key, encrypted to the recipient
    key:Record<string, string>,  // { myDeviceName: 'encrypted-key' }
    content:string
}

/**
 * Encrypt a string and put it into an envelope. The envelope tells us who the
 * recipient of the message is; the message sender is hidden.
 * @param me Your devices, so you can read your own message later.
 * @param recipient The recipient's devices, because we need to encrypt the
 * message to the recipient.
 * @param envelope The envelope we are putting it in
 * @param content The content that will be encrypted to the recipient
 * @returns {[{ envelope:Envelope, message:EncryptedContent }, Keys]}
 *
 * Return an array of [message, keys], where keys is a map of the sender's devices
 * to the symmetric key encrypted to that device. This is returned as a separate
 * object because we *don't* want the sender device names to be in the message.
 */
export async function wrapMessage (
    me:Device[],
    recipient:Device[],  // we need to encrypt the message to the recipient
    envelope:Envelope,
    content:Content
):Promise<[{
    envelope:Envelope,
    message:EncryptedContent
}, Keys]> {
    // encrypt the content *to* the recipient -- encrypt the symmetric key
    // to the exchange key of each of the recipient's devices

    // create a key
    const key = await AES.create({
        alg: ALGORITHM,
        length: DEFAULT_SYMM_LENGTH
    })
    // encrypt the key to the recipient,
    // also encrypt the content with the key
    const encryptedContent = await encryptContent(
        key,
        serialize(content),
        recipient
    )

    return [
        {
            envelope,
            message: encryptedContent,
        },
        await encryptKeys(me, key)]
}

/**
 * Pass in keys, if you are the message author, and thus your keys would not
 * be in the message. If you are the recipient, then your key is in the message.
 *
 * @param {RsaKeys} keys The decrypter's keys
 * @param {EncryptedContent} msg The message to decrypt
 * @param {Keys} [authorKeys] The message author's keys
 * @returns {Promise<Content>}
 */
export async function decryptMessage (
    keys:RsaKeys,
    msg:EncryptedContent,
    authorKeys?:Keys
):Promise<Content> {
    const deviceName = await keys.deviceName
    // if we wrote the message, then our key is in `authorKeys`, not
    //   in the message
    const encryptedKey = (authorKeys || msg.key)[deviceName]

    // this throws if there is no key for this device
    const decryptedKey = await keys.getAesKey(encryptedKey)

    const decrypted = await AES.decrypt(msg.content, decryptedKey)

    return JSON.parse(new TextDecoder().decode(decrypted))
}

/**
 * Create an envelope -- a certificate. Return a signed certificate object
 *
 * @param {CryptoKeyPair} signingKeypair Your signing keys -- `keys.writeKey`
 * @param {{ username:string, seq:number, expiration?:number }} opts
 *   username: your username (the recipient)
 *   seq: an always incrementing integer
 *   expiration: timestamp to expire, default is 0, which means no expiration
 * @returns {Promise<Envelope>} A serizlizable certificate
 */
export async function create (
    signingKeypair:CryptoKeyPair,
    {
        username,
        seq,
        expiration = 0  // no expiration by default
    }:{ username:string, seq:number, expiration?:number }
):Promise<Envelope> {
    const envelope = await createMsg(signingKeypair, {
        seq,
        expiration,
        recipient: username  // our username goes on the envelope
    })

    return envelope
}

/**
 * Take data in string format, and encrypt it with the given symmetric key.
 *
 * @param key The symmetric key used to encrypt/decrypt
 * @param data The text to encrypt
 * @param recipient The devices we are encrypting the key to
 * @returns {Promise<{ key:Keys, content:string }>}
 */
export async function encryptContent (
    key:CryptoKey,
    data:string,
    recipient:Device[]
):Promise<{ key:Keys, content:string }> {
    const encrypted = toString(
        await AES.encrypt(new TextEncoder().encode(data), key),
        'base64pad'
    )
    const encryptedKeys = await encryptKeys(recipient, key)

    return {
        key: encryptedKeys,
        content: encrypted
    }
}

/**
 * Check if an envelope is valid or not. Checks the signature and expiration,
 *   and optionally a sequence number.
 * @param {Envelope} envelope An envelope
 * @param {number} [currentSeq] The last sequence number [optional]
 * @returns {Promise<boolean>}
 */
export function verify (envelope:Envelope, currentSeq?:number):Promise<boolean> {
    if (currentSeq !== undefined) {
        if (envelope.seq <= currentSeq) return Promise.resolve(false)
    }

    if (isExpired(envelope)) return Promise.resolve(false)

    return verifyMsg(envelope)
}

/**
 * Check if this envelope has expired. An expiration of 0 means
 * it does not expire
 * @param {Envelope} envelope An envelope
 * @returns {boolean}
 */
export function isExpired (envelope:Envelope):boolean {
    return (!!envelope.expiration && Date.now() > envelope.expiration)
}

/**
 * Take a given AES key and encrypt it to each of the given devices. The
 * device name is a 32 character hash of the device's DID.
 *
 * @param devices The devices we are encrypting to
 * @param key The key we are encrypting
 * @returns {Promise<Keys>} Map of device name to encrypted key
 */
async function encryptKeys (devices:Device[], key:CryptoKey):Promise<Keys> {
    const encryptedKeys:Keys = {}

    for (const device of devices) {
        const deviceName = await RsaKeys.deviceName(device.DID)
        encryptedKeys[deviceName] = await encryptKeyTo.asString({
            key,
            publicKey: device.publicExchangeKey
        }, 'base64pad')
    }

    return encryptedKeys
}
