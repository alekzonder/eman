'use strict';

var Service = require('./Service');

var _ = require('lodash');

class Services {

    constructor() {
        this._services = {};
    }

    createNewService(id, name) {
        var service  = new Service(id, name);
        this._services[id] = service;
        return service;
    }

    getService(id) {
        if (!this._services[id]) {
            return null;
        }

        return this._services[id];
    }

    removeService(id) {
        delete this._services[id];
    }

    getInfo() {
        var result = {};

        _.each(this._services, (service, id) => {
            result[id] = service.getInfo();
        });

        return result;
    }
}


module.exports = Services;
