'use strict';
var _ = require('lodash');
var Services = require('./Services');

class Eman {

    constructor(logger, io, events) {

        this._logger = logger;

        this._io = io;

        this._events = events;

        this._channel = this._io.of('/communication');

        this._services = new Services();

        this._config = {
            handshake_timeout: 2000
        };

        this._initIo();
    }

    getServiceInfo() {
        return this._services.getInfo();
    }

    _handshake(socket) {

        return new Promise((resolve, reject) => {

            var startHandshakeTime = new Date().getTime();

            var fromIp = socket.handshake.address;

            this._logger.debug(`new connection from ${fromIp}`);

            var serviceId = null;

            var socketService = null;

            var handshakeTimeout = setTimeout(() => {

                var error = new Error('Handshake Timeout', 'handshake_timeout');

                socket.emit('shake_error', {
                    error: {
                        message: 'Handshake Request Timeout',
                        code: 'request_timeout',
                        status: 408
                    }
                });

                socket.disconnect();

                reject(error);

            }, this._config.handshake_timeout);

            socket.on('shake_i_am', (service) => {

                this._logger.trace(`${fromIp} => shake_i_am`, service);

                if (!service || !service.name) {

                    this._logger.error('invalid service name');

                    clearTimeout(handshakeTimeout);

                    this._logger.trace(`${fromIp} <= shake_error invalid_name`);

                    socket.emit('shake_error', {
                        error: {
                            message: 'Invalid Name',
                            code: 'invalid_name',
                            status: 400
                        }
                    });

                    socket.disconnect();
                    reject(new Error('invalid_name', 'invalid_name'));
                    return;
                }

                if (!service.key) {
                    this._logger.error('invalid secret key');

                    this._logger.trace(`${fromIp} <= shake_error invalid_secret_key`);

                    clearTimeout(handshakeTimeout);

                    socket.emit('shake_error', {
                        error: {
                            message: 'Invalid Secret key',
                            code: 'invalid_secret_key',
                            status: 400
                        }
                    });

                    socket.disconnect();

                    reject(new Error('invalid secret key for ' + fromIp, 'invalid_secret_key'));
                    return;
                }

                serviceId = this._generateServiceId(service);

                socketService = this._services.createNewService(serviceId, service.name);

                socketService.setSocket(socket);

                this._logger.trace(`${fromIp} <= shake_id`, serviceId);

                socket.emit('shake_id', {id: serviceId});
            });

            socket.on('shake_ready', (event) => {

                this._logger.trace(`${fromIp} => shake_ready`, event);

                clearTimeout(handshakeTimeout);

                if (!event.id) {
                    this._logger.error('no service id on shake_ready');

                    this._logger.trace(`${fromIp} < shake_error no_id`);

                    socket.emit('shake_error', {
                        error: {
                            message: 'no Service Id',
                            code: 'no_id',
                            status: 400
                        }
                    });

                    socket.disconnect();

                    reject(new Error('no_id', 'no_id'));
                    return;
                }

                if (event.id != serviceId) {
                    this._logger.error('invalid service id on shake_ready');

                    this._logger.trace(`${fromIp} <= shake_error invalid_id`);

                    socket.emit('shake_error', {
                        error: {
                            message: 'Invalid Service Id',
                            code: 'invalid_id',
                            status: 400
                        }
                    });

                    socket.disconnect();

                    reject(new Error('invalid id for ' + fromIp, 'invalid_id'));
                    return;
                }

                this._logger.trace(`${fromIp} <= shake_online`);

                // handshake success
                var endHandshakeTime = new Date().getTime();
                this._logger.debug('handshake done in ' + (endHandshakeTime - startHandshakeTime) + ' ms');

                this._setupService(socketService)
                    .then(() => {
                        socket.emit('shake_online');
                        resolve(socketService);
                    })
                    .catch((error) => {
                        this._logger.error(error);
                    });

            });

            this._logger.trace(`${fromIp} <= shake_who`);

            socket.emit('shake_who');
        });

    }


    _initIo() {

        this._channel.on('connection', (socket) => {

            var fromIp = socket.handshake.address;

            socket.on('error', (error) =>  {
                this._logger.error(error);
            });

            socket.on('disconnect', () => {

                var serviceId = '(no id)' + fromIp;

                if (socket.serviceId) {
                    serviceId = socket.serviceId;
                    this._services.removeService(serviceId);
                }

                this._logger.info(`service id="${serviceId}" disconnect`);
            });

            this._handshake(socket)
                .then((service) => {
                    this._logger.debug('handshake done, service online');
                })
                .catch((error) => {
                    this._logger.error(error);
                });
        });
    }

    _setupService(service) {

        return new Promise((resolve, reject) => {
            var socket = service.getSocket();

            console.log('!!!!!!!!!!!!!!!!', socket.id);

            var serviceId = service.getId();

            // подписываемся на события от сервиса

            socket.on('api:request', (event) => {
                this._processApiRequest(event, service);
            });

            socket.on('api:response', (event) => {
                this._processApiResponse(event, service);
            });

            socket.on('_service:api:request:subscribe', (event) => {

                this._logger.trace(`${serviceId} => _service:api:request:subscribe`, event);

                if (!event.name)  {
                    socket.emit('_service:error', {
                        message: `No "name" in event data on '_service:api:request:subscribe'`,
                        code: 'invalid_data_on_service:api:request:subscribe'
                    });

                    return;
                }

                // service.subscribed_events.push(event.name);
                service.addListeningEvent(event.name);
            });

            socket.on('_service:api:request:unsubscribe', (event) => {

                this._logger.trace(`${serviceId} => _service:api:request:unsubscribe`, event);

                if (!event.name)  {
                    socket.emit('_service:error', {
                        message: `No "name" in event data on '_service:api:request:unsubscribe'`,
                        code: 'invalid_data_on_service:api:request:unsubscribe'
                    });

                    return;
                }

                service.removeListeningEvent(event.name);

            });

            // join to request_flow room
            socket.join('request_flow');

            this._logger.info(`service id="${service.id}" online`);

            resolve();
        });

    }


    _processApiRequest(event, service) {

        var requiredFields = ['name', 'request_id', 'sender_id'];

        if (_.keys( _.pick(event, requiredFields) ).length < requiredFields.length) {

            this._logger.error('no required fields for api:request event "' + event.name + '" from service ' + service.id);

            service.socket.emit('api:request:error', {
                error: {
                    message: 'No required fields ' + requiredFields.join(', '),
                    code: 'no_required_fields',
                    status: 400
                }
            });

            return;
        }

        this._logger.trace('api:request => ' + event.request_id, event);

        this._channel.to('request_flow').emit(event.name, event);
    }


    _processApiResponse(event, service) {

        this._logger.debug('<= api:response for ' + event.request_id, event);

        var requiredFields = ['name', 'request_id', 'sender_id', 'recipient_id'];

        if (_.keys( _.pick(event, requiredFields) ).length < requiredFields.length) {

            this._logger.error('no required fields for api:response event "' + event.name + '" from service ' + service.id, event);

            service.socket.emit('api:response:error', {
                error: {
                    message: 'No required fields ' + requiredFields.join(', '),
                    code: 'no_required_fields',
                    status: 400
                }
            });

            return;
        }

        // send response to sender_id room, socket.io join every socket into room `${socket.id}`
        //
        this._channel.to(service.getSocket().id).emit('api:response', event);
    }

    _generateServiceId(service) {
        return service.name + '.' + new Date().getTime() + '.' + Math.round(Math.random() * 1000);
    }
}

module.exports = Eman;
