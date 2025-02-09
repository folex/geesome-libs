const dhtApi = require('./dht-api');
const startsWith = require('lodash/startsWith');
const pIteration = require('p-iteration');
const ipfsHelper = require('../ipfsHelper');
const {getIpnsUpdatesTopic} = require('../name');
const { subscribeToEvent, registerServiceFunction } = require('@fluencelabs/fluence');

module.exports = class FluenceService {
    constructor(accStorage, client) {
        this.accStorage = accStorage;
        this.client = client;
        this.subscribesByTopics = {};

        subscribeToEvent(this.client, 'api', 'receive_event', (args, _tetraplets) => {
            return this.emitTopicSubscribers(args[0], args[1]);
        });

        registerServiceFunction(this.client, 'GeesomeCrypto', 'checkSignature', (args, _tetraplets) => {
            const [from, data, seqno, signature] = args;
            return ipfsHelper.checkFluenceSignature(from, data, seqno, signature);
        });
    }
    addTopicSubscriber(topic, callback) {
        if (!this.subscribesByTopics[topic]) {
            this.subscribesByTopics[topic] = [];
        }
        this.subscribesByTopics[topic].push(callback);
    }
    emitTopicSubscribers(topic, event) {
        return pIteration.forEach(this.subscribesByTopics[topic] || [], async callback => {
            const parsedEvent = await ipfsHelper.parseFluenceEvent(topic, event);
            return parsedEvent && callback(parsedEvent);
        });
    }
    async bindToStaticId(storageId, accountKey, options = null) {
        if (!startsWith(accountKey, 'Qm')) {
            if (accountKey === 'self') {
                accountKey = await this.accStorage.getOrCreateAccountStaticId(accountKey);
            } else {
                accountKey = await this.accStorage.getAccountStaticId(accountKey);
            }
        }
        await dhtApi.initTopicAndSubscribe(this.client, this.client.relayPeerId, accountKey, storageId, this.client.relayPeerId, null, () => {});
        await this.publishEventByStaticId(accountKey, getIpnsUpdatesTopic(accountKey), '/ipfs/' + storageId);
        return accountKey;
    }
    async resolveStaticId(staticStorageId) {
        if (!startsWith(staticStorageId, 'Qm')) {
            staticStorageId = await this.accStorage.getAccountStaticId(staticStorageId);
        }
        return dhtApi.findSubscribers(this.client, this.client.relayPeerId, staticStorageId).then(results => {
            console.log("subscriber", results[0]);
            return results[0] && results[0].value;
        });
    }
    async removeAccountIfExists(name) {
        return this.accStorage.destroyStaticId(name);
    }
    async getAccountIdByName(name) {
        return this.accStorage.getAccountStaticId(name);
    }
    async createAccountIfNotExists(name) {
        return this.accStorage.getOrCreateAccountStaticId(name);
    }

    async getAccountPeerId(key) {
        return this.accStorage.getAccountPeerId(key);
    }

    async getAccountPublicKey(key) {
        return this.accStorage.getAccountPublicKey(key);
    }

    async getCurrentAccountId() {
        return this.accStorage.getOrCreateAccountStaticId('self');
    }

    async resolveStaticIdEntry(staticStorageId) {
        // TODO: implement
        return null;
        // return this.resolveStaticId(staticStorageId).then(async r => ({pubKey: await this.accStorage.getAccountPublicKey(r)}))
    }

    async keyLookup(ipnsId) {
        return this.accStorage.getAccountPeerId(ipnsId).then(r => r.privKey);
    }

    async getBootNodeList() {
        // TODO: implement
        return [null];
    }

    async addBootNode(address) {
        // TODO: implement
        return [null];
    }

    async removeBootNode(address) {
        // TODO: implement
        return [null];
    }

    async nodeAddressList() {
        // TODO: implement
        return [null];
    }

    async publishEventByStaticId(ipnsId, topic, data) {
        const peerId = await this.accStorage.getAccountPeerId(ipnsId);
        return this.publishEventByPeerId(peerId, topic, data);
    }

    async publishEventByPeerId(peerId, topic, data) {
        return this.publishEventByPrivateKey(peerId._privKey, topic, data);
    }

    async publishEvent(topic, data) {
        await this.accStorage.getOrCreateAccountStaticId('self');
        const selfPeerId = await this.accStorage.getAccountPeerId('self');
        return this.publishEventByPrivateKey(selfPeerId._privKey, topic, data);
    }

    async subscribeToStaticIdUpdates(ipnsId, callback) {
        return this.subscribeToEvent(getIpnsUpdatesTopic(ipnsId), callback);
    }
    async publishEventByPrivateKey(privateKey, topic, data) {
        privateKey = privateKey.bytes || privateKey;
        const event = await ipfsHelper.buildAndSignFluenceMessage(privateKey, data);
        // console.log('fanout_event', this.client.relayPeerId, topic, event);
        return this.publishEventByData(topic, event);
    }

    async publishEventByData(topic, event) {
        // console.log('fanout_event', this.client.relayPeerId, topic, event);
        return new Promise((resolve, reject) => {
            dhtApi.fanout_event(this.client, this.client.relayPeerId, topic, event, (res) => {
                return res === 'done' ? resolve() : reject(res);
            });
        });
    }

    async subscribeToEvent(_topic, _callback) {
        await dhtApi.initTopicAndSubscribe(this.client, this.client.relayPeerId, _topic, _topic, this.client.relayPeerId, null, () => {});
        return this.addTopicSubscriber(_topic, _callback);
    }

    async getStaticIdPeers(ipnsId) {
        return dhtApi.findSubscribers(this.client, this.client.relayPeerId, getIpnsUpdatesTopic(ipnsId));
    }

    async getPubSubLs() {
        return [null];
    }

    async getPeers(topic) {
        if (!topic) {
            return [];
        }
        return dhtApi.findSubscribers(this.client, this.client.relayPeerId, topic);
    }
}