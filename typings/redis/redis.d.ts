// https://github.com/mranney/node_redis

declare module "redis" {
	export function createClient(): RedisClient;
	export function createClient(port_arg, host_arg, options: any): RedisClient;
	export function print(err: Error, reply: any);
	export var debug_mode: boolean;

	interface NodeCallback<T> {
		(err: Error, value: T): void;
	}

	interface RedisClient {
		// event: connect
		// event: error
		// event: message
		// event: pmessage
		// event: subscribe
		// event: psubscribe
		// event: unsubscribe
		// event: punsubscribe

		on(type: string, callback: Function);
		on(type: 'subscribe', callback: (channel: string, count?: number) => void);
		on(type: 'message', callback: (channel: string, message: any) => void);

		end();

		// Connection (http://redis.io/commands#connection)
		auth(password: string, callback?: NodeCallback<any>): void;
		ping(callback?: NodeCallback<number>): void;

		// Strings (http://redis.io/commands#strings)
		append(key: string, value: string, callback?: NodeCallback<number>): void;
		bitcount(key: string, callback?: NodeCallback<number>): void;
		bitcount(key: string, start: number, end: number, callback?: NodeCallback<number>): void;
		set(key: string, value: string, callback?: NodeCallback<string>): void;
		get(key: string, callback?: NodeCallback<string>): void;
		exists(key: string, value: string, callback?: NodeCallback<string>): void;
		subscribe(...channels: string[]): void;

		// Hash
		hdel(key: string, field: string, callback?: NodeCallback<string>): void;
		hdel(key: string, field1: string, field2: string, callback?: NodeCallback<string>): void;

		// Set
		hset(key: string, field: string, value: string, callback?: NodeCallback<string>): void;
		hgetall(key: string, callback?: NodeCallback<any>): void;

		/*
		commands = set_union([
			"get", "set", "setnx", "setex", "append", "strlen", "del", "exists", "setbit", "getbit", "setrange", "getrange", "substr",
			"incr", "decr", "mget", "rpush", "lpush", "rpushx", "lpushx", "linsert", "rpop", "lpop", "brpop", "brpoplpush", "blpop", "llen", "lindex",
			"lset", "lrange", "ltrim", "lrem", "rpoplpush", "sadd", "srem", "smove", "sismember", "scard", "spop", "srandmember", "sinter", "sinterstore",
			"sunion", "sunionstore", "sdiff", "sdiffstore", "smembers", "zadd", "zincrby", "zrem", "zremrangebyscore", "zremrangebyrank", "zunionstore",
			"zinterstore", "zrange", "zrangebyscore", "zrevrangebyscore", "zcount", "zrevrange", "zcard", "zscore", "zrank", "zrevrank", "hset", "hsetnx",
			"hget", "hmset", "hmget", "hincrby", "hdel", "hlen", "hkeys", "hvals", "hgetall", "hexists", "incrby", "decrby", "getset", "mset", "msetnx",
			"randomkey", "select", "move", "rename", "renamenx", "expire", "expireat", "keys", "dbsize", "auth", "ping", "echo", "save", "bgsave",
			"bgrewriteaof", "shutdown", "lastsave", "type", "multi", "exec", "discard", "sync", "flushdb", "flushall", "sort", "info", "monitor", "ttl",
			"persist", "slaveof", "debug", "config", "subscribe", "unsubscribe", "psubscribe", "punsubscribe", "publish", "watch", "unwatch", "cluster",
			"restore", "migrate", "dump", "object", "client", "eval", "evalsha"], require("./lib/commands"));
		*/

		connected: boolean;
		retry_delay: number;
		retry_backoff: number;
		command_queue: any[];
		offline_queue: any[];
		server_info: { redis_version: string; versions: number[]; };
	}
}
