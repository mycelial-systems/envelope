# envelope
![tests](https://github.com/substrate-system/envelope/actions/workflows/nodejs.yml/badge.svg)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@substrate-system/envelope)](https://socket.dev/npm/package/@substrate-system/envelope)
[![module](https://img.shields.io/badge/module-ESM%2FCJS-blue?style=flat-square)](README.md)
[![types](https://img.shields.io/npm/types/@substrate-system/envelope?style=flat-square)](README.md)
[![Common Changelog](https://nichoth.github.io/badge/common-changelog.svg)](./CHANGELOG.md)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![install size](https://packagephobia.com/badge?p=@substrate-system/envelope)](https://packagephobia.com/result?p=@substrate-system/envelope)
[![license](https://nichoth.github.io/badge/license-polyform-shield.svg)](LICENSE)

Envelopes that have been authorized by the recipient. This hides the sender's identity, while the recipient is still visible. This way we hide the *metadata* of who is talking to whom via private message. But, because the recipient is legible, we can still index messages by recipient.

This supports multiple devices by default. You pass in a list of devices, and we encrypt the message to each one. Keys come from [@substrate-system/keys](https://github.com/substrate-system/keys).

Each envelope includes a signature. We want to give out our signed envelopes *privately*, without revealing them publicly.

If we assume we are doing this with internet infrastructure (ie, a server), then in the initial meeting the server would be able to see who we are giving out certificates to because the recipient must be visible. But in subsequent communication, the server would not know who we are talking to; they would just know that we are communicating with someone that we have given a certificate to.

You could also give out the certificates via some other means, like on your website, or via signal message, in which case the server would not know who it is from. Meaning, the server cannot even assume that a message is from your 'friend circle' in the application. It can only see that you got a message at a particular time; we can't infer anything about who it is from.

This is assuming that all the users of the app are well behaved, and not giving out envelopes willy nilly. :thinking:

## contents

<!-- toc -->

- [install](#install)
- [metaphors](#metaphors)
- [keys](#keys)
- [an envelope](#an-envelope)
- [a message in an envelope](#a-message-in-an-envelope)
- [types](#types)
  * [Envelope](#envelope)
  * [Device](#device)
  * [EncryptedContent](#encryptedcontent)
  * [Content](#content)
- [API](#api)
  * [create](#create)
  * [wrapMessage](#wrapmessage)
  * [decryptMessage](#decryptmessage)
  * [verify](#verify)
  * [isExpired](#isexpired)
  * [encryptContent](#encryptcontent)
  * [ALGORITHM](#algorithm)

<!-- tocstop -->

## install

```sh
npm i -S @substrate-system/envelope
```

## metaphors
If we stick with comparisons to common physical activities, this is very similar to the postal service. The envelope shows the recipient, and it needs a stamp (the signature here), but it hides the sender's ID.

## keys
The envelopes and encrypted messages pair with a [keys instance](https://github.com/substrate-system/keys) on your device.

We create a symmetric key and encrypt it to various "exchange" keys. The exchange keys are non-extractable key pairs that can only be used on the device where they were created.

That way the documents created by this library can be freely distributed without leaking any keys.

A "device" here is the public half of one keypair -- the object you get back from `keys.toJson()`. Collect one per device to encrypt a message to all of someone's devices.

```ts
import { RsaKeys } from '@substrate-system/keys/rsa'

const keys = await RsaKeys.create()
const device = await keys.toJson()
// => { DID: 'did:key:z...', publicExchangeKey: '...' }
```

## an envelope
Just a document signed by the recipient, like this:

```js
// envelope
{
    seq: 0,
    expiration: 456,
    recipient: 'my-username',
    signature: '123abc',
    author: 'did:key:z123abc'
}
```

## a message in an envelope

```js
// the message
{
    envelope,
    message: {
        key: { deviceName: 'encrypted-key' },
        content: 'encrypted text'
    }
}
// sender ID is in the encrypted content, so it is only readable by
//   the recipient
```

## types

### Envelope
`create` fills in `expiration` for you, so it is always present on an
envelope. A value of `0` means it never expires.

```ts
import type { SignedMessage } from '@substrate-system/message'

type Envelope = SignedMessage<{
    seq:number,
    expiration:number,  // 0 means no expiration
    recipient:string,  // the recipient's username
}>
```

`SignedMessage` adds a `signature` and an `author` DID, so the full shape is

```ts
{
    seq:number,
    expiration:number,
    recipient:string,
    signature:string,
    author:`did:key:z${string}`
}
```

### Device
The public keys for a single device. This is the shape returned by `keys.toJson()`.

```ts
import type { DID } from '@substrate-system/keys/rsa'

interface Device {
    DID:DID,
    publicExchangeKey:string
}
```

### EncryptedContent
When you encrypt a string, we create a record of keys. The `key` object is a map from device name to a symmetric key that has been encrypted to the device. We do it this way because each device has its own keypair. We use the symmetric key to encrypt the content.

The device name is a 32 character, DNS-friendly hash of the device's DID, the same string you get from `keys.deviceName`.

```ts
interface EncryptedContent {
    key:Keys,  // { deviceName: 'encrypted-key' }
    content:string  // encrypted text
}
```

That map of device name to encrypted key is exported as `Keys`. It shows up
again on its own, as the second item that [`wrapMessage`](#wrapmessage)
returns.

```ts
type Keys = Record<string, string>
```

### Content
The plaintext that goes inside an envelope. Create it with `create` from
[@substrate-system/message](https://github.com/substrate-system/message), so
that it is signed by the sender.

```ts
import type { SignedMessage } from '@substrate-system/message'

type Content = SignedMessage<{
    from:{ username:string },
    text:string,
    mentions?:string[],
}>
```

## API

### create
Create an envelope. Sign it with your write key -- `keys.writeKey`.

```ts
async function create (
    signingKeypair:CryptoKeyPair,
    {
        username,
        seq,
        expiration = 0  // no expiration by default
    }:{ username:string, seq:number, expiration?:number }
):Promise<Envelope>
```

#### example
```ts
import { RsaKeys } from '@substrate-system/keys/rsa'
import { create } from '@substrate-system/envelope'

const alice = await RsaKeys.create()

const envelope = await create(alice.writeKey, {
    username: 'alice',
    seq: 1
})
```

### wrapMessage
Create a new AES key, take an envelope and some content. Encrypt the content, then put the content in the envelope.

This will encrypt the AES key to every one of the recipient's devices, as well as every one of your own devices.

```ts
async function wrapMessage (
    me:Device[],  // your devices, so you can read this later
    recipient:Device[],  // because we need to encrypt the message to them
    envelope:Envelope,
    content:Content
):Promise<[{
    envelope:Envelope,
    message:EncryptedContent
}, Keys]>
```

#### example
```ts
import { wrapMessage } from '@substrate-system/envelope'

const [
    { envelope, message },
    bobsKeys
] = await wrapMessage(
    [await bob.toJson()],    // bob's devices
    [await alice.toJson()],  // alice's devices
    alicesEnvelope,
    content
)
```

This returns an array of
```js
[{ envelope, message: encryptedMessage }, { ...senderKeys }]
```

> [!NOTE]
> __We return the sender keys as a seperate object__ because we *do not* want the sender's device names to be in the message that gets sent, because that would leak information about who the sender is.

The sender could save a map of the message's hash to the returned key object. That way they can save the map to some storage, and then look up the key by the hash of the message object.

### decryptMessage
Decrypt a given message. Depends on having a keys instance that the message was encrypted to. Throws if the message has no key for your device. Return a [`Content`](#content) object:
```ts
async function decryptMessage (
    keys:RsaKeys,
    msg:EncryptedContent,
    authorKeys?:Keys
):Promise<Content>
```

> [!NOTE]
> This does not check the signature on the decrypted content. Decrypting tells
> you the message was encrypted to one of your devices, not that `from.username`
> is who they say they are. Call `verify` from
> [@substrate-system/message](https://github.com/substrate-system/message) on
> the returned object if you need that.

#### example
```ts
import { decryptMessage } from '@substrate-system/envelope'

const decrypted = await decryptMessage(alice, msgContent)

console.log(decrypted.from.username)
// => bob
console.log(decrypted.text)
// => hello
```

#### Decrypt a message that I wrote
Pass in the keys as a separate argument if you are the message author. The
sender's keys are not in the message evnelope, because we need to keep your
device names out of the unencrypted envelope.

```js
import { decryptMessage } from '@substrate-system/envelope'

// bobs keys were not in the envelope, because doing so would
// reveal information about the message author, Bob.
const decrypted = await decryptMessage(bob, msgContent, bobsMsgKeys)

console.log(decrypted.from.username)
// => bob

console.log(decrypted.text)
// => hello
```

### verify
Check if a given envelope is valid. This checks the signature, the expiration,
and optionally a sequence number.

`currentSeq` is an optional sequence number to check against -- the last
sequence number you have seen from this author. If `seq` in the `envelope` is
less than or equal to `currentSeq`, then this will return `false`. That is, a
valid envelope must have a sequence number greater than the last one you saw.

```ts
function verify (envelope:Envelope, currentSeq?:number):Promise<boolean>
```

```ts
test('check that the envelope is valid', async t => {
    const isValid = await verify(alicesEnvelope)
    t.equal(isValid, true, 'should validate a valid envelope')

    t.equal(await verify(alicesEnvelope, 0), true,
        'should take a sequence number')

    t.equal(await verify(alicesEnvelope, 1), false,
        'should say a message is invalid if the sequence number is equal')

    try {
        await verify('baloney')
    } catch (err) {
        t.ok(err, 'should throw given a malformed message')
    }
})
```

### isExpired
Check if an envelope has expired. An `expiration` of `0` means it never
expires, so this returns `false`. This is the expiration check that `verify`
does internally.

```ts
function isExpired (envelope:Envelope):boolean
```

### encryptContent
The lower level function used by [`wrapMessage`](#wrapmessage). Encrypt a string
with the given symmetric key, and encrypt that key to each of the given
devices. Use `wrapMessage` unless you need to manage the symmetric
key yourself.

```ts
async function encryptContent (
    key:CryptoKey,
    data:string,
    recipient:Device[]
):Promise<{ key:Keys, content:string }>
```

### ALGORITHM
The symmetric algorithm used to encrypt content -- re-exported from
[@substrate-system/keys](https://github.com/substrate-system/keys) as
`DEFAULT_SYMM_ALGORITHM`.

```ts
import { ALGORITHM } from '@substrate-system/envelope'
```

----------------------------------

Thanks to [@Dominic](https://github.com/dominictarr/) for sketching this idea originally.
