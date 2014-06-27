///<reference path="typings/node/node.d.ts" />
///<reference path="typings/tspromise/tspromise.d.ts" />
///<reference path="typings/redis/redis.d.ts" />

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

/*
import redis = require('redis');
var redisSubClient = redis.createClient();
redisSubClient.on('message', (channel, message) => {
	console.log(channel + ':' + message);
});
redisSubClient.subscribe('tspm');

var redisClient = redis.createClient();
redisClient.hset('tspm_map', 'sample', 'value');
redisClient.hgetall('tspm_map', (err, result) => {
	console.log(result);
});
*/

class MapFileEntry {
	constructor(public domain:string, public jsfile:string) {
	}

	toString() {
		return this.domain + ',' + this.jsfile;
	}
}

class MapFile {
	private entries: MapFileEntry[] = [];

	constructor() {
	}

	private getUserHome() {
		//return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
		return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
	}

	getMapFilePath() {
		return this.getUserHome() + '/.node-tspm';
	}

	private ensureExists() {
		var path = this.getMapFilePath();
		if (!fs.existsSync(path)) {
			fs.writeFileSync(path, '', 'utf8');
		}
	}

	load() {
		this.ensureExists();
		var contents = fs.readFileSync(this.getMapFilePath(), 'utf8');
		this.entries = [];
		contents.split("\n").forEach((line) => {
			line = line.trim();
			if (line.length) {
				var parts = line.split(',');
				var domain = parts[0];
				var jsfile = parts[1];
				this.entries.push(new MapFileEntry(domain, jsfile));
			}
		});
	}

	save() {
		fs.writeFileSync(this.getMapFilePath(), this.entries.join("\n"), 'utf8');
	}

	list() {
		if (!this.entries.length) {
			console.log(('file is empty')['green']);
		} else {
			console.log('items:');
			this.entries.forEach((entry) => {
				console.log(String(entry)['green']);
			});
		}
	}

	set(domain: string, jsfile: string) {
		var found = false;
		this.entries.forEach((entry) => {
			if (entry.domain == domain) {
				entry.jsfile = jsfile;
				found = true;
			}
		});
		if (!found) {
			this.entries.push(new MapFileEntry(domain, jsfile));
		}
	}

	remove(domain: string) {
		for (var n = 0; n < this.entries.length; n++) {
			if (this.entries[n].domain == domain) {
				this.entries.splice(n, 1);
				return;
			}
		}
	}
}

var mapFile = new MapFile();
mapFile.load();

var pid_file = __dirname + '/tspm_daemon.pid';
var log_file = __dirname + '/tspm_daemon.log';

process.on('SIGTERM', function () {
	console.log('Got SIGTERM.  Press Control-D to exit.');
	process.exit(0);
});

process.on('SIGINT', function () {
	console.log('Got SIGINT.  Press Control-D to exit.');
	process.exit(0);
});

switch (process.argv[2]) {
	case 'list':
		mapFile.list();
		//process.exit(0);
		return;
		break;
	case 'set':
		mapFile.set(process.argv[3], process.argv[4]);
		mapFile.list();
		mapFile.save();
		process.exit(0);
		break;
	case 'remove':
		mapFile.remove(process.argv[3]);
		mapFile.list();
		mapFile.save();
		process.exit(0);
		break;
	case 'daemon':
		var out = fs.openSync(log_file, 'a');
		var child = require('child_process').spawn(process.argv[0], ['--harmony', process.argv[1], 'server'], {
			detached: true,
			stdio: ['ignore', out, out]
		});
		child.unref();
		fs.writeFileSync(pid_file, '' + child.pid);
		console.log(process.pid + ' -> ' + child.pid);
		return process.exit(0);

		break;
	case 'daemon_stop':
		if (fs.existsSync(pid_file)) {
			process.kill(parseInt(<string><any>(fs.readFileSync(pid_file, { encoding: 'utf8' }))), 'SIGTERM');
			fs.unlinkSync(pid_file);
		}
		return process.exit(0);
		break;
	case 'log':
		console.log('log: ' + log_file);

		var ls = child_process.spawn('tail', ['-f', log_file]);
		//var ls = child_process.spawn('type', [log_file]);

		ls.stdout.on('data', function (data) {
			process.stdout.write(data);
		});

		ls.stderr.on('data', function (data) {
			process.stderr.write(data);
		});

		ls.on('close', function (code) {
			console.log('child process exited with code ' + code);
			process.exit(code);
		});

		return;

		break;
	case 'server':
		break;
	case 'help':
	default:
		console.log('tspm:');
		console.log('- tspm list');
		console.log('- tspm set <domain> <path_to_js>');
		console.log('- tspm remove <domain>');
		console.log('- tspm server');
		console.log('- tspm daemon');
		console.log('- tspm daemon_stop');
		console.log('- tspm log');
		process.exit(-1);
		break;
}



//console.log('os:' + os.platform());


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
			var timems = 5000;

			console.log('exit:' + code + ',' + signal + ': restarting in ' + timems + ' milliseconds');
			setTimeout(() => { this.restart(); }, timems)
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

		proxy.on('error', (err) => {
			console.error(String(err)['red']);
		});

		var getServiceByRequest = ((req: http.ServerRequest) => {
			var host = req.headers.host;
			return this.serviceByDomain[host];
		});

		var proxyServer = http.createServer((req, res) => {
			try {
				var service = getServiceByRequest(req);

				if (service) {
					proxy.web(req, res, { target: 'http://127.0.0.1:' + service.port, ws: true });
				} else {
					res.writeHead(500, { 'Content-Type': 'text/plain' });
					res.write('Invalid request');
					res.end();
				}
			} catch (e) {
				console.error(String(e)['red']);
			}
		});

		proxyServer.on('error', (err) => {
			console.error(String(err)['red']);
		});

		proxyServer.on('upgrade', (req, socket, head) => {
			try {
				var service = getServiceByRequest(req);

				if (service) {
					proxy.ws(req, socket, { target: 'http://127.0.0.1:' + service.port, ws: true });
				} else {
					socket.close();
				}
			} catch (e) {
				console.error(String(e)['red']);
			}
		});

		proxyServer.listen(port);
	}
}

console.log('Main process: ' + process.pid);

var port = process.env.PORT || 80;
var server = new Server();
server.watchMapFile(mapFile.getMapFilePath());
server.listen(port);
console.log('listening at ' + port);
