import { test } from '@substrate-system/tapzero'
import { create as createMsg } from '@substrate-system/message'
import { RsaKeys } from '@substrate-system/keys/rsa'
import {
    create as createEnvelope,
    verify,
    Envelope,
    wrapMessage,
    EncryptedContent,
    decryptMessage,
    Keys,
} from '../src/index.js'

let alicesEnvelope:Envelope
let alice:RsaKeys

test('create an envelope', async t => {
    alice = await RsaKeys.create(true)
    alicesEnvelope = await createEnvelope(alice.writeKey, {
        username: 'alice',
        seq: 1
    })

    t.equal(alicesEnvelope.seq, 1, 'should have sequence number 0')
    t.ok(alicesEnvelope.signature, 'should create an envelope')
    t.equal(alicesEnvelope.expiration, 0, 'should have 0 expiration by defualt')
    t.equal(alicesEnvelope.recipient, 'alice',
        "alice's username should be on the envelope")
})

let msgContent:EncryptedContent
let bobsMsgKeys:Keys
let bob:RsaKeys
test('put a message in the envelope', async t => {
    bob = await RsaKeys.create(true)

    const content = await createMsg(bob.writeKey, {
        from: { username: 'bob' },
        text: 'hello'
    })

    const [
        { envelope, message },  // the encrypted message content
        keys  // map of sender's device name to encrypted key string
    ] = await wrapMessage(
        [await bob.toJson()],
        [await alice.toJson()],
        alicesEnvelope,
        content
    )

    bobsMsgKeys = keys
    msgContent = message

    t.ok(envelope, 'should return the envelope')
    t.ok(Object.keys(keys).includes(await bob.deviceName),
        "should include bob's device name in the keys object")
    t.equal(envelope.signature, alicesEnvelope.signature,
        'the envelope we get back shoud be equal to what was passed in')
    t.ok(message, 'should return the encrypted content')
    t.ok(keys, 'should return keys as a separate argument')
})

test('check that the envelope is valid', async t => {
    t.plan(4)
    const isValid = await verify(alicesEnvelope)
    t.equal(isValid, true, 'should validate a valid envelope')

    t.equal(await verify(alicesEnvelope, 0), true,
        'should take a sequence number')

    t.equal(await verify(alicesEnvelope, 1), false,
        'should say a message is invalid if the sequence number is equal')

    try {
        // @ts-expect-error test failure
        await verify('baloney')
    } catch (err) {
        t.ok(err, 'should throw given a malformed message')
    }
})

test('alice can decrypt a message addressed to alice', async t => {
    const decrypted = await decryptMessage(alice, msgContent)

    t.equal(decrypted.from.username, 'bob',
        "should have bob's username in decrypted message")
    t.equal(decrypted.text, 'hello', 'can decrypt the message')
})

test('bob can decrypt a message that he created', async t => {
    const decrypted = await decryptMessage(bob, msgContent, bobsMsgKeys)

    t.ok(decrypted, 'should decrypt without error')
    t.equal(decrypted.from.username, 'bob',
        'can read the decrypted text')
    t.equal(decrypted.text, 'hello', 'can read decrypted text')
})

test('round trip non-ASCII text', async t => {
    const text = 'héllo, 世界 🌱'

    const content = await createMsg(bob.writeKey, {
        from: { username: 'bob' },
        text
    })

    const [{ message }] = await wrapMessage(
        [await bob.toJson()],
        [await alice.toJson()],
        alicesEnvelope,
        content
    )

    const decrypted = await decryptMessage(alice, message)

    t.equal(decrypted.text, text,
        'should decrypt multi-byte characters unchanged')
})

test("carol cannot read alice's message", async t => {
    t.plan(1)
    const carol = await RsaKeys.create(true)

    try {
        await decryptMessage(carol, msgContent)
        t.fail('should throw with the wrong keys')
    } catch (err) {
        t.ok(err, 'should throw if we use the wrong keys')
    }
})

test('all done', () => {
    // @ts-expect-error tests
    window.testsFinished = true
})
