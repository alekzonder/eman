'use strict';

var _ = require('lodash');

class Service {

    constructor(id, name) {

        this._info = {
            id: id,
            name: name,
            subscribed_events: []
        };

        this._socket = null;
    }

    getId() {
        return this._info.id;
    }

    getName() {
        return this._info.name;
    }

    getInfo() {
        return _.cloneDeep(this._info);
    }

    setSocket(socket) {
        this._socket = socket;
        this._socket.serviceId = this._info.id;
    }

    getSocket() {
        return this._socket;
    }

    addListeningEvent(name) {
        if (this._isListenEvent(name) > -1) {
            throw new Error('service ' + this._info.id + ' already listen event ' + name);
        }

        this._info.subscribed_events.push(name);
    }

    removeListeningEvent(name) {
        var index = this._isListenEvent(name);

        if (index > -1) {
            delete this._info.subscribed_events[index];
        }
    }

    _isListenEvent(name) {
        return this._info.subscribed_events.indexOf(name);
    }

}

module.exports = Service;
