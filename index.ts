///<reference path="typings/node/node.d.ts" />
///<reference path="typings/tspromise/tspromise.d.ts" />

declare function require(name: string): any;

import Promise = require('tspromise');
var httpProxy = require('http-proxy');
var _ = require('underscore');

import fs = require('fs');
import os = require('os');
import child_process = require('child_process');
import http = require('http');
import net = require('net');
import path = require('path');
var colors = require('colors');

class MapFile {
	private getUserHome() {
		//return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
		return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
	}

	private getMapFilePath() {
		return this.getUserHome() + '/.node-tspm';
	}

	ensureExists() {
		var path = this.getMapFilePath();
		if (!fs.existsSync(path)) {
			fs.writeFileSync(path, '', 'utf8');
		}
	}

	list() {
		var contents = fs.readFileSync(this.getMapFilePath(), 'utf8');
		if (!contents.length) {
			contents = 'file is empty';
		}
		console.log((contents)['green']);
	}

	constructor() {
	}
}

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

interface StringDictionary<T> {
	[name: string]: T;
}

function getAvailablePortAsync(bindAddress: string = '127.0.0.1') {
	return new Promise<number>((resolve) => {
		var server2 = net.createServer();
		server2.listen(0, bindAddress, 1, () => {
			var port = server2.address().port;
			server2.close(() => {
				resolve(port);
			});
		});
	});
}

class Service {
	private cmd: string;
	private args: string[];
	private path: string;
	private _port: number;
	private child: child_process.ChildProcess;

	constructor(private domain:string) {
	}

	setParameters(cmd: string, args: string[], path: string, port: number) {
		if (this.cmd === cmd) return;
		if (this.args === args) return;
		if (this.path === path) return;
		if (this._port === port) return;

		this.cmd = cmd;
		this.args = args;
		this.path = path;
		this._port = port;

		this.restart();
	}

	get port() {
		return this._port;
	}

	private restart() {
		if (this.child) this.child.kill();

		this.child = spawn(this.cmd, this.args, {
			cwd: this.path,
			env: _.extend({}, process.env, { PORT: this._port }),
			//stdio: ['ignore', 'ignore', 'ignore']
		});

		console.log(('started ' + this.domain + ':' + this.port + ', process: ' + this.child.pid)['cyan']);

		this.child.stdout.on('data', (m) => {
			process.stdout.write(('[' + this.domain + ']:' + m.toString('utf8'))['green']);
		});

		this.child.on('exit', (code, signal) => {
			console.log('exit:' + code + ',' + signal + ': restarting in one second');
			setTimeout(() => {
				this.restart();
			}, 5000)
		});

		this.child.on('error', (err) => {
			console.log(('error:' + err)['red']);
		});
	}

	// { PORT: port }
}

class Server {
	private serviceByDomain: StringDictionary<Service> = {};

	getServiceByDomain(name: string) {
		if (!this.serviceByDomain[name]) this.serviceByDomain[name] = new Service(name);
		return this.serviceByDomain[name];
	}

	private parseConfigFileContentsAsync(config: string) {
		var port = 9000;
		var promise = Promise.resolve<any>();
		config.split('\n').forEach((line) => {
			line = line.trim();

			if (!line.length) return;

			var parts = line.split(',', 2);
			var domain = parts[0];
			var scriptFile = parts[1];

			promise = promise.then<any>(() => {
				return getAvailablePortAsync().then((port) => {
					console.log(domain + ':' + port + ' -> ' + scriptFile);
					this.getServiceByDomain(domain).setParameters('node', ['--harmony', path.basename(scriptFile)], path.dirname(scriptFile), port++);
				});
			});
		});

		return promise;
	}

	private parseConfigFileAsync(mapFile: string) {
		console.log('Loading... ' + mapFile);
		return Promise.nfcall<string>(fs, 'readFile', mapFile, 'utf8').then((content) => {
			return this.parseConfigFileContentsAsync(content);
		});
	}

	watchMapFile(mapFile: string) {
		console.log('Watching... ' + mapFile);
		fs.watchFile(mapFile, (curr, prev) => {
			this.parseConfigFileAsync(mapFile);
		});
		this.parseConfigFileAsync(mapFile);
	}

	listen(port: number) {
		var proxy = httpProxy.createProxyServer({ ws: true });

		var getServiceByRequest = ((req: http.ServerRequest) => {
			var host = req.headers.host;
			return this.serviceByDomain[host];
		});

		var proxyServer = http.createServer((req, res) => {
			var service = getServiceByRequest(req);

			if (service) {
				proxy.web(req, res, { target: 'http://127.0.0.1:' + service.port, ws: true });
			} else {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.write('Invalid request');
				res.end();
			}
		});

		proxyServer.on('upgrade', (req, socket, head) => {
			var service = getServiceByRequest(req);

			if (service) {
				proxy.ws(req, socket, { target: 'http://127.0.0.1:' + service.port, ws: true });
			} else {
				socket.close();
			}
		});

		proxyServer.listen(port);
	}
}

console.log('Main process: ' + process.pid);

var port = process.env.PORT || 80;
var server = new Server();
server.watchMapFile(getMapFile());
server.listen(port);
console.log('listening at ' + port);

