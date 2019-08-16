const ipfsHelper = require('./ipfsHelper');
const _ = require('lodash');
const ipfsImproves = require('./ipfsImproves');
const {promisify} = require('es6-promisify');

const { getIpnsUpdatesTopic } = require('./name');

module.exports = class JsIpfsService {
  constructor(node) {
    this.node = node;
    
    if(node.libp2p) {
      this.fsub = node.libp2p._floodSub;

      ipfsImproves.improveFloodSub(this.fsub);
      ipfsImproves.improvePubSub(this.fsub);
      this.fSubPublishByPeerId = promisify(this.fsub.publishByPeerId).bind(this.fsub);
      this.fSubPublish = promisify(this.fsub.publish).bind(this.fsub);
      this.pubSubSubscribe = promisify(node.pubsub.subscribe).bind(node.pubsub);
    } else {
      console.warn("[JsIpfsService] Warning: libp2p features disabled")
    }

    this.id = promisify(node.id).bind(node);
    this.stop = promisify(node.stop).bind(node);
    this.swarmConnect = promisify(node.swarm.connect).bind(node.swarm);
  }

  async wrapIpfsItem(ipfsItem) {
    return {
      id: ipfsItem.hash,
      path: ipfsItem.path,
      size: ipfsItem.size,
      // storageAccountId: await this.getCurrentAccountId()
    }
  }

  async saveFileByUrl(url) {
    const result = await this.node.addFromURL(url);
    await this.node.pin.add(result[0].hash);
    return this.wrapIpfsItem(result[0]);
  }

  async saveDirectory(path) {
    const result = await this.node.addFromFs(path, {recursive: true, ignore: []});
    const dirName = _.last(path.split('/'));
    const dirResult = _.find(result, {path: dirName});
    await this.node.pin.add(dirResult.hash);
    return this.wrapIpfsItem(dirResult);
  }

  async saveBrowserFile(fileObject) {
    const result = await this.node.add(fileObject);
    await this.node.pin.add(result[0].hash);
    return this.wrapIpfsItem(result[0]);
  }

  async saveFileByData(content) {
    if (_.isString(content)) {
      content = Buffer.from(content, 'utf8');
    }
    return this.saveFile({content});
  }

  async saveFile(options) {
    const result = await this.node.add([options]);
    await this.node.pin.add(result[0].hash);
    return this.wrapIpfsItem(result[0]);
  }

  async getAccountIdByName(name) {
    const keys = await this.node.key.list();
    return (_.find(keys, {name}) || {}).id || null;
  }

  async getAccountNameById(id) {
    const keys = await this.node.key.list();
    return (_.find(keys, {id}) || {}).name || null;
  }

  async getCurrentAccountId() {
    return this.getAccountIdByName('self');
  }

  async createAccountIfNotExists(name) {
    const accountId = await this.getAccountIdByName(name);
    if (accountId) {
      return accountId;
    }
    return this.node.key.gen(name, {
      type: 'rsa',
      size: 2048
    }).then(result => result.id);
  }

  async removeAccountIfExists(name) {
    const accountId = await this.getAccountIdByName(name);
    if (!accountId) {
      return;
    }
    return this.node.key.rm(name);
  }

  getFileStream(filePath) {
    return new Promise((resolve, reject) => {
      this.node.getReadableStream(filePath).on('data', (file) => {
        resolve(file.content);
      });
    });
  }

  getFileData(filePath) {
    return this.node.cat(filePath).then((result) => result);
  }

  async saveObject(objectData) {
    // objectData = _.isObject(objectData) ? JSON.stringify(objectData) : objectData;
    const savedObj = await this.node.dag.put(objectData);
    const ipldHash = ipfsHelper.cidToHash(savedObj);
    await this.node.pin.add(ipldHash);
    return ipldHash;
  }

  async getObject(storageId) {
    if (ipfsHelper.isCid(storageId)) {
      storageId = ipfsHelper.cidToHash(storageId);
    }
    return this.node.dag.get(storageId).then(response => response.value);
  }

  async getObjectProp(storageId, propName) {
    return this.node.dag.get(storageId + '/' + propName).then(response => response.value);
  }
  
  getObjectRef(storageId) {
    return {
      '/' : storageId
    }
  }

  async bindToStaticId(storageId, accountKey, hours = 1) {
    if (_.startsWith(accountKey, 'Qm')) {
      accountKey = await this.getAccountNameById(accountKey);
    }
    return this.node.name.publish(`${storageId}`, {
      key: accountKey,
      lifetime: hours + 'h'
    }).then(response => response.name);
  }

  async resolveStaticId(staticStorageId) {
    return this.node.name.resolve(staticStorageId).then(response => {
      return (response && response.path ? response.path : response).replace('/ipfs/', '')
    });
  }

  async getBootNodeList() {
    return new Promise((resolve, reject) => {
      let responded = false;
      setTimeout(() => {
        if (responded) {
          return;
        }
        reject('Failed to fetch');
      }, 1000);
      this.node.bootstrap.list((err, res) => {
        responded = true;
        return err ? reject(err) : resolve(res.Peers);
      });
    });
  }

  async addBootNode(address) {
    try {
      await this.swarmConnect(address);
    } catch (e) {
      console.warn('addBootNode swarm.connect error', address, e);
    }
    return new Promise((resolve, reject) => {
      this.node.bootstrap.add(address, (err, res) => err ? reject(err) : resolve(res.Peers));
    });
  }

  async removeBootNode(address) {
    await new Promise((resolve, reject) => {
      this.node.swarm.disconnect(address, (err, res) => err ? reject(err) : resolve());
    });
    return new Promise((resolve, reject) => {
      this.node.bootstrap.rm(address, (err, res) => err ? reject(err) : resolve(res.Peers))
    });
  }

  async nodeAddressList() {
    return this.id().then(nodeId => nodeId.addresses);
  }

  async nodeAddress(includes = null) {
    let addresses = await this.nodeAddressList();

    if(includes) {
      return _.find(addresses, (address) => {
        return _.includes(address, includes);
      });
    } else {
      return _.filter(addresses, (address) => {
        return !_.includes(address, '127.0.0.1') && !_.includes(address, '192.168') && !_.includes(address, '/p2p-circuit/ipfs/');
      })[0];
    }
  }
  
  subscribeToIpnsUpdates(ipnsId, callback) {
    const topic = getIpnsUpdatesTopic(ipnsId);
    return this.subscribeToEvent(topic, callback);
  }
  
  publishEventByPeerId(peerId, topic, data) {
    if(_.isObject(data)) {
      data = JSON.stringify(data);
    }
    if(_.isString(data)) {
      data = new Buffer(data);
    }
    return this.fSubPublishByPeerId(peerId, topic, data);
  }
  
  async publishEventByIpnsId(ipnsId, topic, data) {
    return this.publishEventByPeerId(await this.getAccountPeerId(ipnsId), topic, data);
  }

  getIpnsPeers(ipnsId) {
    const topic = getIpnsUpdatesTopic(ipnsId);
    return this.getPeers(topic);
  }
  
  getPeers(topic) {
    return this.node.pubsub.peers(topic);
  }

  getPubSubLs() {
    return this.node.pubsub.ls();
  }

  publishEvent(topic, data) {
    if(_.isObject(data)) {
      data = JSON.stringify(data);
    }
    if(_.isString(data)) {
      data = new Buffer(data);
    }
    return this.fSubPublish(topic, data);
  }

  subscribeToEvent(topic, callback) {
    return this.pubSubSubscribe(topic, async (event) => {
      ipfsHelper.parsePubSubEvent(event).then(parsedEvent => {
        callback(parsedEvent);
      }).catch((error) => {
        console.warn("PubSub ipns validation failed", event, error);
      })
    });
  }
  
  async keyLookup(accountKey) {
    if (_.startsWith(accountKey, 'Qm')) {
      accountKey = await this.getAccountNameById(accountKey);
    }
    return new Promise((resolve, reject) => {
      ipfsHelper.keyLookup(this.node, accountKey, (err, res) => {
        return err ? reject(err) : resolve(res);
      })
    });
  }

  async getAccountPeerId(accountKey) {
    const privateKey = await this.keyLookup(accountKey);
    return ipfsHelper.createPeerIdFromPrivKey(privateKey.bytes);
  }
};
