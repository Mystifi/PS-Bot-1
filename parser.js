'use strict';

const request = require('request');
const fs = require('fs');

global.Commands = require('./commands.js');
fs.readdirSync('./plugins/').forEach(function (file) {
	if (file.substr(-3) === '.js') Object.assign(Commands.commands, require('./plugins/' + file).commands);
});

let ranks = [' ', '+', '\u2605', '%', '@', '#', '&', '~', 'admin'];
let permissions = Config.defaultPermissions;

try {
	permissions = JSON.parse(fs.readFileSync('config/permissions.json', 'utf8'));
} catch (e) {
	fs.writeFileSync('config/permissions.json', JSON.stringify(Config.defaultPermissions));
}

module.exports = class Parser {
	constructor(serverid) {
		this.serverid = serverid;
	}

	parse(roomid, data) {
		let server = Servers[this.serverid];
		if (!server) return;
		if (data.charAt(0) !== '|') data = '||' + data;
		let parts = data.split('|');
		switch (parts[1]) {
		case 'challstr':
			this.challengekeyid = parts[2];
			this.challenge = parts[3];
			server.send('/cmd rooms');
			if (server.name !== '') this.login(server.name, server.pass);
			if (server.name === '') {
				if (typeof server.rooms === "object") {
					for (let u in server.rooms) server.send('/join ' + server.rooms[u]);
					server.joinedRooms = true;
				}
			}
			break;
		case 'c:':
			this.parseChat(roomid, parts[3], parts.slice(4).join('|'), '');
			this.logChat(toId(roomid), data);
			if (Tools.updateSeen) Tools.updateSeen(parts[3].substr(1, parts[2].length), 'talking', server.id, (~server.privaterooms.indexOf(roomid) ? "a private room" : roomid));
			if (Tools.sendTell) Tools.sendTell(parts[3].substr(1, parts[2].length), server);
			break;
		case 'c':
			this.parseChat(roomid, parts[2], parts.slice(3).join('|'), '');
			this.logChat(toId(roomid), data);
			if (Tools.updateSeen) Tools.updateSeen(parts[2].substr(1, parts[2].length), 'talking', server.id, (~server.privaterooms.indexOf(roomid) ? "a private room" : roomid));
			if (Tools.sendTell) Tools.sendTell(parts[2].substr(1, parts[2].length), server);
			break;
		case 'updateuser':
			if (toId(parts[2]) !== toId(server.name)) return;
			if (!server.joinedRooms && parts[3] === '1') {
				if (typeof server.rooms === "object") {
					for (let u in server.rooms) server.send('/join ' + server.rooms[u]);
					server.joinedRooms = true;
				}
				for (let i in server.privaterooms) server.send('/join ' + server.privaterooms[i]);
			}
			break;
		case 'pm':
			if (~parts[4].indexOf('/invite')) {
				this.pm = "/msg " + parts[2] + ", ";
				this.user = parts[2];
				this.room = parts[4];
				if (this.can('invite')) {
					return server.send('/join ' + parts[4].substr(8));
				}
			}
			this.parseChat(roomid, parts[2], parts.slice(4).join('|'), '/msg ' + parts[2] + ', ');
			if (Tools.sendTell) Tools.sendTell(parts[2].substr(1, parts[2].length), server);
			break;
		case 'join':
		case 'j':
		case 'J':
			if (Tools.updateSeen) Tools.updateSeen(parts[2].substr(1, parts[2].length), 'joining', server.id, (~server.privaterooms.indexOf(roomid) ? "a private room" : roomid));
			if (Tools.sendTell) Tools.sendTell(parts[2].substr(1, parts[2].length), server);
			this.logChat(toId(roomid), data);
			break;
		case 'l':
		case 'L':
			if (Tools.updateSeen) Tools.updateSeen(parts[2].substr(1, parts[2].length), 'leaving', server.id, (~server.privaterooms.indexOf(roomid) ? "a private room" : roomid));
			this.logChat(toId(roomid), data);
			break;
		case 'raw':
		case 'html':
			if (data.substr(0, 50) !== '<div class="infobox"><div class="infobox-limited">') {
				this.logChat(toId(roomid), data);
			}
			if (data.match(new RegExp(toId(server.name) + "\<\/font\>\<\/b\> has [0-9]+ bucks")) && this.transferAllBucks) {
				let amount = data.match(/[0-9]+ buck/g)[0].replace(/[a-z]/gi, '').trim();
				this.send("/transferbucks " + this.transferAllBucks + ", " + amount);
				delete this.transferAllBucks;
			}
			break;
		case 'popup':
			let message = parts.slice(2).join('|');
			if (message.match(/You were kicked from (.*) by (.*)./)) {
				let kickedRoom = message.replace(/You were kicked from /, '').replace(/\bby(.*)/, '').trim();
				let kicker = message.replace(/You were kicked from (.*) by/, '').trim().slice(0, -1);
				Tools.log('Kicked from ' + kickedRoom + ' by ' + kicker, server.id);
			}
			break;
		case 'queryresponse':
			switch (parts[2]) {
			case 'rooms':
				if (parts[3] === 'null') break;

				let roomData = JSON.parse(parts.slice(3).join('|'));
				server.roomList = {
					'official': [],
					'chat': [],
				};
				for (let a in roomData['official']) {
					server.roomList['official'].push(toId(roomData['official'][a].title));
				}
				for (let b in roomData['chat']) {
					server.roomList['chat'].push(toId(roomData['chat'][b].title));
				}
				if (!server.joinedRooms) {
					if (server.rooms === 'all') {
						this.joinAllRooms(true);
						server.joinedRooms = true;
					} else if (server.rooms === 'official') {
						this.joinAllRooms(false);
						server.joinedRooms = true;
					}
				}
				break;
			}
			break;
		case 'N':
			if (~data.indexOf('\n')) {
				this.logChat(toId(roomid), data.trim());
			}
			break;
		case 'deinit':
			if (server.leaving) {
				server.leaving = false;
			} else if (server.rejoinOnKick && ~server.roomList.official.indexOf(toId(roomid))) {
				Tools.log("Attempting to rejoin " + roomid, server.id);
				server.send('/join ' + roomid);
			}
			break;
		case '':
			this.logChat(toId(roomid), parts.slice(2).join('|'));
			break;
		}
	}

	joinAllRooms(chat) {
		let server = Servers[this.serverid];
		if (!server.roomList) return;
		for (let c in server.roomList.official) {
			server.send('/join ' + server.roomList.official[c]);
		}
		if (chat) {
			for (let d in server.roomList.chat) {
				server.send('/join ' + server.roomList.chat[d]);
			}
		}
	}

	send(message, room) {
		if (!room) room = '';
		Servers[this.serverid].send(message, room);
	}

	sendReply(message) {
		if (!this.can('broadcast')) this.pm = "/msg " + this.user.substr(1) + ", ";
		this.send(this.pm + message, this.room);
	}

	disconnect(reconnect) {
		if (!Servers[this.serverid]) return Tools.log('Not connected to ' + this.serverid + '.', this.serverid);
		Servers[this.serverid].disconnecting = true;
		Servers[this.serverid].connection.close();
		Servers[this.serverid].connected = false;
		if (Servers[this.serverid].ping) clearInterval(Servers[this.serverid].ping);
		delete Servers[this.serverid];
		Tools.log("Disconnected from " + this.serverid + ".", this.serverid);
		if (reconnect) connect(this.serverid);
	}

	can(permission) {
		if (Config.admins.includes(toId(this.user))) return true;
		if (!permissions[permission]) return false;
		if (ranks.indexOf(this.user.charAt(0)) >= ranks.indexOf(permissions[permission])) return true;
		return false;
	}

	parseChat(room, user, message, pm) {
		let server = Servers[this.serverid];
		if (!pm) pm = '';
		if (message.charAt(0) === Config.trigger && !server.noReply && server.name !== '') {
			let command = toId(message.substr(1, (~message.indexOf(' ') ? message.indexOf(' ') : message.length)));
			let target = (~message.indexOf(' ') ? message.substr(message.indexOf(' '), message.length) : '');
			if (Commands.commands[command]) {
				while (typeof Commands.commands[command] !== 'function') {
					command = Commands.commands[command];
				}
				if (typeof Commands.commands[command] === 'function') {
					try {
						this.pm = pm;
						this.user = user;
						this.room = room;
						Commands.commands[command].call(this, target, room, user, pm);
					} catch (e) {
						server.send(pm + e.stack.substr(0, e.stack.indexOf('\n')), room);
						Tools.log(e.stack, server.id, true);
					}
				}
			}
		}
	}

	logChat(room, data) {
		if (Config.log < 1) return;
		// I'm sure there's a better way to do this instead of a bunch of try-catch
		// but this will work for now
		let date = new Date();
		try {
			fs.statSync('logs/chat');
		} catch (e) {
			fs.mkdirSync('logs/chat', '0755');
		}
		try {
			fs.statSync('logs/chat/' + this.serverid);
		} catch (e) {
			fs.mkdirSync('logs/chat/' + this.serverid, '0755');
		}
		try {
			fs.statSync('logs/chat/' + this.serverid + '/' + room);
		} catch (e) {
			fs.mkdirSync('logs/chat/' + this.serverid + '/' + room, '0755');
		}
		try {
			fs.statSync('logs/chat/' + this.serverid + '/' + room + '/' + Tools.toTimeStamp(date));
		} catch (e) {
			fs.mkdirSync('logs/chat/' + this.serverid + '/' + room + '/' + Tools.toTimeStamp(date), '0755');
		}
		fs.appendFile('logs/chat/' + this.serverid + '/' + room + '/' + Tools.toTimeStamp(date) + '/' + Tools.toTimeStamp(date) + '.txt', data + '\n');
	}

	login(name, pass) {
		let server = Servers[this.serverid];
		let self = this;
		let options;
		if (pass !== '') {
			options = {
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
				},
				url: 'http://play.pokemonshowdown.com/action.php',
				body: "act=login&name=" + encodeURIComponent(name) + "&pass=" + encodeURIComponent(pass) + "&challengekeyid=" + this.challengekeyid + "&challenge=" + this.challenge,
			};
			request.post(options, callback);
		} else {
			options = {
				url: 'http://play.pokemonshowdown.com/action.php?act=getassertion&userid=' + toId(name) + '&challengekeyid=' + this.challengekeyid + '&challenge=' + this.challenge,
			};
			request(options, callback);
		}

		function callback(error, response, body) {
			if (body === ';') return Tools.log('Failed to log in, name is registered', self.serverid);
			if (body.length < 50) return Tools.log('Failed to log in: ' + body, self.serverid);
			if (~body.indexOf('heavy load')) {
				Tools.log('Failed to log in - login server is under heavy load. Retrying in one minute.', self.serverid);
				setTimeout(function () {
					self.login(name, pass);
				}, 60 * 1000);
				return;
			}
			if (body.substr(0, 16) === '<!DOCTYPE html>') {
				Tools.log('Connection error 522 - retrying in one minute', self.serverid);
				setTimeout(function () {
					self.login(name, pass);
				}, 60 * 1000);
				return;
			}
			try {
				let json = JSON.parse(body.substr(1, body.length));
				if (json.actionsuccess) {
					server.send('/trn ' + name + ',0,' + json['assertion']);
				} else {
					Tools.log('Could not log in: ' + JSON.stringify(json), self.serverid);
				}
			} catch (e) {
				server.send('/trn ' + name + ',0,' + body);
			}
		}
	}
};
