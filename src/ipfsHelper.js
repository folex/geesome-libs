/*
 * Copyright ©️ 2019 GaltProject Society Construction and Terraforming Company
 * (Founded by [Nikolai Popeka](https://github.com/npopeka)
 *
 * Copyright ©️ 2019 Galt•Core Blockchain Company
 * (Founded by [Nikolai Popeka](https://github.com/npopeka) by
 * [Basic Agreement](ipfs/QmaCiXUmSrP16Gz8Jdzq6AJESY1EAANmmwha15uR3c1bsS)).
 */

const CID = require('cids');

const startsWith = require('lodash/startsWith');
const isString = require('lodash/isString');

const ipns = require('ipns');
const { DAGNode, util: DAGUtil } = require('ipld-dag-pb');
const uint8ArrayConcat = require('uint8arrays/concat')
const uint8ArrayFromString = require('uint8arrays/from-string')

const crypto = require('libp2p-crypto');
const {RPC} = require('libp2p-interfaces/src/pubsub/message/rpc');
const {signMessage, SignPrefix: Libp2pSignPrefix} = require('libp2p-interfaces/src/pubsub/message/sign');
const {normalizeOutRpcMessage, randomSeqno, ensureArray} = require('libp2p-interfaces/src/pubsub/utils');
const dagCBOR = require('ipld-dag-cbor')
const PeerId = require('peer-id');
const GeesomeSignPrefix = uint8ArrayFromString('geesome:');

const ipfsHelper = {
  isIpfsHash(value) {
    if (!value) {
      return false;
    }
    return startsWith(value, 'Qm') && /^\w+$/.test(value);
  },
  isIpldHash(value) {
    if (!value) {
      return false;
    }
    return startsWith(value.codec, 'dag-') || (isString(value) && /^\w+$/.test(value) && (startsWith(value, 'zd') || startsWith(value, 'ba')));
  },
  isCid(value) {
    return CID.isCID(value);
  },
  cidToHash(cid) {
    const cidsResult = new CID(1, 'dag-cbor', cid.multihash || Buffer.from(cid.hash.data));
    return cidsResult.toBaseEncodedString();
  },
  cidToIpfsHash(cid) {
    if (!CID.isCID(cid)) {
      cid = new CID(cid)
    }

    // if (cid.version === 0 && options.base && options.base !== 'base58btc') {
    //   if (!options.upgrade) return cid.toString();
    //   cid = cid.toV1()
    // }

    return cid.toBaseEncodedString();
  },
  async keyLookup(ipfsNode, kname, pass) {
    const pem = await ipfsNode.key.export(kname, pass);
    return crypto.keys.import(pem, pass);
  },

  async encryptPrivateBase64WithPass(privateBase64, pass) {
    return (await this.createPeerIdFromPrivateBase64(privateBase64)).privKey.export(pass)
  },

  async decryptPrivateBase64WithPass(encryptedPrivateKey, pass) {
    return Buffer.from((await crypto.keys.import(encryptedPrivateKey, pass)).bytes).toString('base64');
  },

  peerIdToPrivateBase64(peerId) {
    return peerId.marshalPrivKey().toString('base64');
  },

  peerIdToPublicBase64(peerId) {
    return peerId.marshalPubKey().toString('base64');
  },

  peerIdToPublicBase58(peerId) {
    return peerId.toB58String();
  },

  async createPeerIdFromPrivateBase64(base64) {
    return ipfsHelper.createPeerIdFromPrivKey(Buffer.from(base64, 'base64'));
  },

  async createPeerIdFromPublicBase64(base64) {
    return ipfsHelper.createPeerIdFromPubKey(Buffer.from(base64, 'base64'));
  },

  base64ToPublicKey(base64) {
    return Buffer.from(base64, 'base64');
  },

  publicKeyToBase64(publicKey) {
    return publicKey.toString('base64');
  },

  createPeerId: PeerId.create.bind(PeerId),
  createPeerIdFromPubKey: PeerId.createFromPubKey.bind(PeerId),
  createPeerIdFromPrivKey: PeerId.createFromPrivKey.bind(PeerId),
  createPeerIdFromIpns: PeerId.createFromCID.bind(PeerId),

  // extractPublicKeyFromId(peerId) {
  //   const decodedId = multihash.decode(peerId.id);
  //  
  //   console.log('decodedId', decodedId);
  //
  //   if (decodedId.code !== ID_MULTIHASH_CODE) {
  //     return null
  //   }
  //
  //   return crypto.keys.unmarshalPublicKey(decodedId.digest)
  // },

  async parsePubSubEvent(event) {
    if(event.key) {
      event.keyPeerId = await ipfsHelper.createPeerIdFromPubKey(event.key);
      event.key = event.keyPeerId._pubKey;
      event.keyIpns = event.keyPeerId.toB58String();

      const pubSubSignatureValid = await ipfsHelper.checkPubSubSignature(event.key, event);
      if(!pubSubSignatureValid) {
        throw "pubsub_signature_invalid";
      }
    }
    
    try {
      event.data = ipns.unmarshal(event.data);
      event.data.valueStr = event.data.value.toString('utf8');
      event.data.peerId = await ipfsHelper.createPeerIdFromPubKey(event.data.pubKey);
      
      const validateRes = await ipns.validate(event.data.peerId._pubKey, event.data);
    } catch (e) {
      // not ipns event
      // console.warn('Failed unmarshal ipns of event', event);
      event.dataStr = event.data.toString('utf8');
      try {
        event.dataJson = JSON.parse(event.dataStr);
      } catch (e) {}
    }
    return event;
  },

  checkPubSubSignature(pubKey, message) {
    // const checkMessage = pick(message, ['from', 'data', 'seqno', 'topicIDs']);

    // Get message sans the signature
    const bytes = uint8ArrayConcat([
      Libp2pSignPrefix,
      RPC.Message.encode({
        ...message,
        // @ts-ignore message.from needs to exist
        from: PeerId.createFromCID(message.from).toBytes(),
        signature: undefined,
        key: undefined
      }).finish()
    ])

    // verify the base message
    return pubKey.verify(bytes, message.signature)
  },
  
  async getIpfsHashFromString(string) {
    const UnixFS = require('ipfs-unixfs');
    const unixFsFile = new UnixFS({ type: 'file', data: Buffer.from(string) });
    const buffer = unixFsFile.marshal();

    const node = new DAGNode(buffer);
    const serialized = DAGUtil.serialize(node);
    const cid = await DAGUtil.cid(serialized, { cidVersion: 0 });

    return cid.toBaseEncodedString();
  },

  async getIpldHashFromObject(object) {
    return ipfsHelper.cidToHash(await dagCBOR.util.cid(dagCBOR.util.serialize(object)));
  },

  async buildAndSignPubSubMessage(privateKey, topics, data) {
    const peerId = await ipfsHelper.createPeerIdFromPrivKey(privateKey);
    const from = peerId.toB58String();
    let msgObject = {
      data,
      from,
      receivedFrom: from,
      seqno: randomSeqno(),
      topicIDs: ensureArray(topics)
    }
    return signMessage(peerId, normalizeOutRpcMessage(msgObject));
  },

  async buildAndSignFluenceMessage(privateKeyBase64, data) {
    const peerId = await ipfsHelper.createPeerIdFromPrivateBase64(privateKeyBase64);
    const from = ipfsHelper.peerIdToPublicBase64(peerId);
    const message = {
      data,
      from,
      seqno: randomSeqno()
    };
    const bytes = uint8ArrayConcat([GeesomeSignPrefix, RPC.Message.encode(message).finish()]);
    const signature = await peerId.privKey.sign(bytes);
    return {
      ...message,
      signature: signature.toString('base64'),
    }
  },

  async parseFluenceEvent(topic, event) {
    event.data = Buffer.from(event.data.data);
    event.seqno = Buffer.from(event.seqno.data);
    event.signature = Buffer.from(event.signature, 'base64');

    const fromPeerId = await ipfsHelper.createPeerIdFromPublicBase64(event.from);
    const signatureValid = await ipfsHelper.checkFluenceSignature(fromPeerId.pubKey, event);
    if (!signatureValid) {
      console.log('signature_not_valid');
      return null;
    }

    if (startsWith(topic, 'Qm')) {
      const split = topic.split('/');
      const staticBase58 = split[0];
      const fromBase58 = ipfsHelper.peerIdToPublicBase58(fromPeerId);
      if (staticBase58 !== fromBase58) {
        console.log('static_id_not_match');
        return null;
      }
      event.staticType = split[1];
    }

    if (event.from) {
      event.fromPeerId = fromPeerId;
      event.from = event.fromPeerId.pubKey;
      event.fromIpns = event.fromPeerId.toB58String();
    }

    try {
      event.dataStr = event.data.toString('utf8');
    } catch (e) {}

    try {
      if (event.dataStr) {
        event.dataJson = JSON.parse(event.dataStr);
      }
    } catch (e) {}

    return event;
  },

  checkFluenceSignature(pubKey, event) {
    const message = {
      data: event.data,
      from: event.from,
      seqno: event.seqno
    };
    const bytes = uint8ArrayConcat([GeesomeSignPrefix, RPC.Message.encode(message).finish()]);

    return pubKey.verify(bytes, event.signature)
  },

  async createDaemonNode(options = {}, ipfsOptions = {}) {
    const hat = require('hat');
    const {createFactory} = require('ipfsd-ctl');

    const factory = createFactory({
      type: 'proc', // or 'js' to run in a separate process
      // type: 'js',
      ipfsHttpModule: require('ipfs-http-client'),
      ipfsModule: require('ipfs'), // only if you gonna spawn 'proc' controllers
      ...options
    })

    const node = await factory.spawn({
      ipfsOptions: {
        pass: hat(),
        init: true,
        // start: true,
        ...ipfsOptions
      },
      // preload: {enabled: false, addresses: await this.getPreloadAddresses()}
    });

    return node.api;
  }
};
module.exports = ipfsHelper;
