'use strict';
var _ = require('lodash');

class Communication {

    constructor(logger, io, events) {

        this._logger = logger;

        this._io = io;

        this._events = events;

        this._channel = this._io.of('/communication');

        this._services = {};

        this._config = {
            handshake_timeout: 2000
        };

        this._initIo();
    }

    _handshake(socket) {

        return new Promise((resolve, reject) => {

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

                socketService = {
                    id: serviceId,
                    name: service.name
                };

                this._services[serviceId] = socketService;

                socket.serviceId = serviceId;

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

                socket.emit('shake_online');

                resolve(socketService);
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
                }

                if (socket.serviceId) {
                    delete this._services[socket.serviceId];
                }

                this._logger.info(`service id="${serviceId}" disconnect`);
            });

            var startHandshakeTime = new Date().getTime();

            this._handshake(socket)
                .then((service) => {
                    // handshake success
                    var endHandshakeTime = new Date().getTime();
                    this._logger.debug('handshake done in ' + (endHandshakeTime - startHandshakeTime) + ' ms');
                    this._setupService(service, socket);
                })
                .catch((error) => {
                    this._logger.error(error);
                });
        });
    }

    _setupService(service, socket) {

        this._services[service.id] = service;
        this._services[service.id].socket = socket;

        // подписываемся на события от сервиса

        socket.on('api:request', (event) => {
            this._processApiRequest(event, service);
        });

        socket.on('api:response', (event) => {
            this._processApiResponse(event, service);
        });

        // join to request_flow room
        socket.join('request_flow');
        socket.join(service.id);

        this._logger.info(`service id="${service.id}" online`);
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

        // отправляем ответ непосредственно сервису который запрос сделал

        // TODO уже есть комната для сокета конкретного ее создает socket.io по умолчанию
        this._channel.to(event.sender_id).emit('api:response', event);
    }

    _generateServiceId(service) {
        return service.name + '.' + new Date().getTime() + '.' + Math.round(Math.random() * 1000);
    }
}

module.exports = Communication;
