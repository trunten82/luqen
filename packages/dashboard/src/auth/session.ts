import type { FastifyInstance } from 'fastify';
import secureSession from '@fastify/secure-session';

export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
}

export interface SessionData {
  token?: string;
  user?: SessionUser;
}

export async function registerSession(
  server: FastifyInstance,
  sessionSecret: string,
): Promise<void> {
  await server.register(secureSession, {
    secret: sessionSecret,
    salt: 'pally-dash-salt!',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    },
    sessionName: 'session',
  });
}
