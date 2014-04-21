///<reference path="typings/node/node.d.ts" />
///<reference path="typings/tspromise/tspromise.d.ts" />

var Promise = require('tspromise');
var httpProxy = require('http-proxy');
var _ = require('underscore');

var fs = require('fs');
var os = require('os');
var child_process = require('child_process');
var http = require('http');
var net = require('net');
var path = require('path');
var colors = require('colors');

var MapFile = (function () {
    function MapFile() {
    }
    MapFile.prototype.getUserHome = function () {
        //return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
        return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    };

    MapFile.prototype.getMapFilePath = function () {
        return this.getUserHome() + '/.node-tspm';
    };

    MapFile.prototype.ensureExists = function () {
        var path = this.getMapFilePath();
        if (!fs.existsSync(path)) {
            fs.writeFileSync(path, '', 'utf8');
        }
    };

    MapFile.prototype.list = function () {
        var contents = fs.readFileSync(this.getMapFilePath(), 'utf8');
        if (!contents.length) {
            contents = 'file is empty';
        }
        console.log((contents)['green']);
    };
    return MapFile;
})();

var mapFile = new MapFile();
mapFile.ensureExists();

switch (process.argv[2]) {
    case 'list':
        mapFile.list();
        process.exit(0);
        break;
    case 'help':
    default:
        console.log('tspm:');
        console.log('- tspm list');
        console.log('- tspm set <domain> <path_to_js>');
        console.log('- tspm remove <domain>');
        process.exit(-1);
        break;
}

console.log('os:' + os.platform());

if (os.platform() !== 'win32') {
    if (process.argv[2] != 'child') {
        var out = fs.openSync('./out.log', 'a');
        var child = require('child_process').spawn(process.argv[0], ['--harmony', process.argv[1], 'child'], {
            detached: true,
            stdio: ['ignore', out, out]
        });
        child.unref();
        console.log(process.pid + ' -> ' + child.pid);
        return process.exit(0);
    }
}

//require('daemon')();
//console.log(process.pid);
//console.log('bbbbb');
var spawn = child_process.spawn;

function getAvailablePortAsync(bindAddress) {
    if (typeof bindAddress === "undefined") { bindAddress = '127.0.0.1'; }
    return new Promise(function (resolve) {
        var server2 = net.createServer();
        server2.listen(0, bindAddress, 1, function () {
            var port = server2.address().port;
            server2.close(function () {
                resolve(port);
            });
        });
    });
}

var Service = (function () {
    function Service(domain) {
        this.domain = domain;
    }
    Service.prototype.setParameters = function (cmd, args, path, port) {
        if (this.cmd === cmd)
            return;
        if (this.args === args)
            return;
        if (this.path === path)
            return;
        if (this._port === port)
            return;

        this.cmd = cmd;
        this.args = args;
        this.path = path;
        this._port = port;

        this.restart();
    };

    Object.defineProperty(Service.prototype, "port", {
        get: function () {
            return this._port;
        },
        enumerable: true,
        configurable: true
    });

    Service.prototype.restart = function () {
        var _this = this;
        if (this.child)
            this.child.kill();

        this.child = spawn(this.cmd, this.args, {
            cwd: this.path,
            env: _.extend({}, process.env, { PORT: this._port })
        });

        console.log(('started ' + this.domain + ':' + this.port + ', process: ' + this.child.pid)['cyan']);

        this.child.stdout.on('data', function (m) {
            process.stdout.write(('[' + _this.domain + ']:' + m.toString('utf8'))['green']);
        });

        this.child.on('exit', function (code, signal) {
            console.log('exit:' + code + ',' + signal + ': restarting in one second');
            setTimeout(function () {
                _this.restart();
            }, 5000);
        });

        this.child.on('error', function (err) {
            console.log(('error:' + err)['red']);
        });
    };
    return Service;
})();

var Server = (function () {
    function Server() {
        this.serviceByDomain = {};
    }
    Server.prototype.getServiceByDomain = function (name) {
        if (!this.serviceByDomain[name])
            this.serviceByDomain[name] = new Service(name);
        return this.serviceByDomain[name];
    };

    Server.prototype.parseConfigFileContentsAsync = function (config) {
        var _this = this;
        var port = 9000;
        var promise = Promise.resolve();
        config.split('\n').forEach(function (line) {
            line = line.trim();

            if (!line.length)
                return;

            var parts = line.split(',', 2);
            var domain = parts[0];
            var scriptFile = parts[1];

            promise = promise.then(function () {
                return getAvailablePortAsync().then(function (port) {
                    console.log(domain + ':' + port + ' -> ' + scriptFile);
                    _this.getServiceByDomain(domain).setParameters('node', ['--harmony', path.basename(scriptFile)], path.dirname(scriptFile), port++);
                });
            });
        });

        return promise;
    };

    Server.prototype.parseConfigFileAsync = function (mapFile) {
        var _this = this;
        console.log('Loading... ' + mapFile);
        return Promise.nfcall(fs, 'readFile', mapFile, 'utf8').then(function (content) {
            return _this.parseConfigFileContentsAsync(content);
        });
    };

    Server.prototype.watchMapFile = function (mapFile) {
        var _this = this;
        console.log('Watching... ' + mapFile);
        fs.watchFile(mapFile, function (curr, prev) {
            _this.parseConfigFileAsync(mapFile);
        });
        this.parseConfigFileAsync(mapFile);
    };

    Server.prototype.listen = function (port) {
        var _this = this;
        var proxy = httpProxy.createProxyServer({ ws: true });

        var getServiceByRequest = (function (req) {
            var host = req.headers.host;
            return _this.serviceByDomain[host];
        });

        var proxyServer = http.createServer(function (req, res) {
            var service = getServiceByRequest(req);

            if (service) {
                proxy.web(req, res, { target: 'http://127.0.0.1:' + service.port, ws: true });
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.write('Invalid request');
                res.end();
            }
        });

        proxyServer.on('upgrade', function (req, socket, head) {
            var service = getServiceByRequest(req);

            if (service) {
                proxy.ws(req, socket, { target: 'http://127.0.0.1:' + service.port, ws: true });
            } else {
                socket.close();
            }
        });

        proxyServer.listen(port);
    };
    return Server;
})();

console.log('Main process: ' + process.pid);

var port = process.env.PORT || 80;
var server = new Server();
server.watchMapFile(getMapFile());
server.listen(port);
console.log('listening at ' + port);
