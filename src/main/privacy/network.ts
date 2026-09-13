import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
// Defense in depth for our Node APIs. This is NOT a native-process firewall.
export function denyNodeNetwork(): void {
  const deny = () => { throw new Error('EXTERNAL_NETWORK_DISABLED'); };
  Object.assign(http, { request: deny, get: deny }); Object.assign(https, { request: deny, get: deny });
  Object.assign(net, { connect: deny, createConnection: deny }); Object.assign(net.Socket.prototype, { connect: deny });
  Object.assign(tls, { connect: deny }); Object.assign(dgram, { createSocket: deny });
  Object.assign(dns, { lookup: deny, resolve: deny });
  globalThis.fetch = (() => Promise.reject(new Error('EXTERNAL_NETWORK_DISABLED'))) as typeof fetch;
  syncBuiltinESMExports();
}
