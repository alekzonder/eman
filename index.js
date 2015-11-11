// var blocked = require('blocked');
//
// blocked(function(ms){
//   console.log('BLOCKED FOR %sms', ms | 0);
// });

var socket = require('socket.io');
var app = require('express')();
var server = require('http').createServer(app);
var Logger = require('log4js');
var EventEmitter = require('events').EventEmitter;

var Communication = require('./Communication');

var config = {
    port: process.env.PORT || 9001
};

var logger = Logger.getLogger('[eman]');
var io = socket(server);

var events = new EventEmitter();

io.on('connection', function (socket) {
    console.log('new');
});

app.get('/', (req, res) => {
    res.json({
        result: {
            id: 'eman'
        }
    });
});

server.listen(config.port, function (s) {
    logger.info('listen on ' + config.port);
});

var comChannel = new Communication(logger, io, events);
