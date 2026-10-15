// -----------------------------------------------------------------------------
// Minimal Modbus TCP client.
//
// Why not a library: the integration only needs three function codes, and a
// SolarEdge inverter has two quirks a generic client handles poorly:
//   - it accepts ONE Modbus TCP connection at a time: the client keeps a
//     single persistent socket and never opens a second one;
//   - it is slow to answer and does not like pipelining: requests are queued
//     and sent strictly one after the other.
//
// The socket factory is injectable (`createConnection`), so the tests run the
// client against an in-memory fake inverter, without any network.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  FUNCTION_CODES,
  buildReadRequest,
  buildWriteMultipleRequest,
  buildWriteSingleRequest,
  extractFrames,
  parseResponse,
} from './frame.js';

const logger = createLogger({ name: 'modbus' });

const DEFAULT_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 5000;

function defaultCreateConnection({ host, port }) {
  return net.createConnection({ host, port });
}

export class ModbusTcpClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {number} [options.timeout] request timeout, in ms
   * @param {Function} [options.createConnection] `({ host, port }) => Duplex`
   */
  constructor({ host, port, timeout = DEFAULT_TIMEOUT_MS, createConnection }) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.createConnection = createConnection ?? defaultCreateConnection;
    this.socket = null;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    this.transactionId = 0;
    this.pending = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  get connected() {
    return this.socket !== null && this.connecting === null;
  }

  async connect() {
    if (this.closed) {
      throw new Error('Modbus client closed');
    }
    if (this.socket && !this.connecting) {
      return;
    }
    if (this.connecting) {
      await this.connecting;
      return;
    }
    this.connecting = new Promise((resolve, reject) => {
      const socket = this.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection to ${this.host}:${this.port} timed out`));
      }, CONNECT_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    try {
      const socket = await this.connecting;
      this.attach(socket);
      logger.info(`Connected to ${this.host}:${this.port}`);
    } finally {
      this.connecting = null;
    }
  }

  attach(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    socket.setNoDelay?.(true);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.drop(err));
    socket.on('close', () => this.drop(new Error('Connection closed by the inverter')));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, rest } = extractFrames(this.buffer);
    this.buffer = rest;
    for (const response of frames) {
      const pending = this.pending;
      // A late answer to a request that already timed out: ignore it.
      if (!pending || response.transactionId !== pending.transactionId) {
        continue;
      }
      this.pending = null;
      clearTimeout(pending.timer);
      try {
        pending.resolve(parseResponse(pending.functionCode, response.pdu));
      } catch (err) {
        pending.reject(err);
      }
    }
  }

  // The socket died: fail the in-flight request, the next one reconnects.
  drop(err) {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.on('error', () => {});
      this.socket.destroy();
      this.socket = null;
      logger.debug(`Connection dropped: ${err.message}`);
    }
    if (this.pending) {
      const { reject, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      reject(err);
    }
  }

  // Requests run one at a time, in order: each one waits for the previous.
  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  send(functionCode, buildRequest) {
    return this.enqueue(async () => {
      await this.connect();
      this.transactionId = (this.transactionId + 1) & 0xffff;
      const transactionId = this.transactionId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // A request without answer leaves the stream in an unknown state:
          // start over with a fresh connection.
          this.drop(new Error(`Modbus request timed out after ${this.timeout} ms`));
        }, this.timeout);
        this.pending = { transactionId, functionCode, resolve, reject, timer };
        this.socket.write(buildRequest(transactionId));
      });
    });
  }

  /**
   * Read `count` holding registers from `address`.
   * @returns {Promise<number[]>}
   */
  readHoldingRegisters(unitId, address, count) {
    return this.send(FUNCTION_CODES.READ_HOLDING_REGISTERS, (tid) =>
      buildReadRequest(tid, unitId, address, count),
    );
  }

  writeRegister(unitId, address, value) {
    return this.send(FUNCTION_CODES.WRITE_SINGLE_REGISTER, (tid) =>
      buildWriteSingleRequest(tid, unitId, address, value),
    );
  }

  writeRegisters(unitId, address, registers) {
    return this.send(FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS, (tid) =>
      buildWriteMultipleRequest(tid, unitId, address, registers),
    );
  }

  close() {
    this.closed = true;
    this.drop(new Error('Modbus client closed'));
  }
}
