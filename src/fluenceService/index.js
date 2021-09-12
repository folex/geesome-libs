const dhtApi = require('./dht-api');
const startsWith = require('lodash/startsWith');
const pIteration = require('p-iteration');
const ipfsHelper = require('../ipfsHelper');
const {getIpnsUpdatesTopic} = require('../name');

module.exports = class FluenceService {
    constructor(accStorage, client) {
        this.accStorage = accStorage;
        this.client = client;
        this.subscribesByTopics = {};

        dhtApi.registerClientAPI(this.client, 'api', {
            receive_event: (topic, e) => {
                this.emitTopicSubscribers(topic, e);
            }
        });

        dhtApi.registerClientAPI(this.client, 'GeesomeCrypto', {
            checkSignature: (from, data, seqno, signature) => {
                return ipfsHelper.checkFluenceSignature(from, data, seqno, signature);
            }
        });
    }
    getClientRelayId() {
        return this.client.getStatus().relayPeerId;
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
        await dhtApi.initTopicAndSubscribe(this.client, this.getClientRelayId(), accountKey, storageId, this.getClientRelayId(), null, () => {});
        await this.publishEventByStaticId(accountKey, getIpnsUpdatesTopic(accountKey), '/ipfs/' + storageId);
        return accountKey;
    }
    async resolveStaticId(staticStorageId) {
        if (!startsWith(staticStorageId, 'Qm')) {
            staticStorageId = await this.accStorage.getAccountStaticId(staticStorageId);
        }
        return dhtApi.findSubscribers(this.client, this.getClientRelayId(), staticStorageId).then(results => {
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
            dhtApi.fanout_event(this.client, this.getClientRelayId(), topic, event, (res) => {
                return res === 'done' ? resolve() : reject(res);
            });
        });
    }

    async subscribeToEvent(_topic, _callback) {
        console.log('initTopicAndSubscribe client', this.client, this.getClientRelayId(), _topic, _topic, this.getClientRelayId());
        await dhtApi.initTopicAndSubscribe(this.client, this.getClientRelayId(), _topic, _topic, this.getClientRelayId(), null, () => {});
        console.log('addTopicSubscriber')
        return this.addTopicSubscriber(_topic, _callback);
    }

    async getStaticIdPeers(ipnsId) {
        return dhtApi.findSubscribers(this.client, this.getClientRelayId(), getIpnsUpdatesTopic(ipnsId));
    }

    async getPubSubLs() {
        return [null];
    }

    async getPeers(topic) {
        if (!topic) {
            return [];
        }
        return dhtApi.findSubscribers(this.client, this.getClientRelayId(), topic);
    }
}