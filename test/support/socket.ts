import { io, type Socket } from 'socket.io-client';

export function connect(
  url: string,
  token: string | undefined,
): Promise<Socket> {
  const socket = io(`${url}/game`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

export function ack<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown = {},
): Promise<T> {
  return socket.timeout(3000).emitWithAck(event, payload) as Promise<T>;
}

export function next<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
  matches: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const listener = (payload: T) => {
      if (!matches(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timeout esperando ${event}`));
    }, timeoutMs);
    socket.on(event, listener);
  });
}
