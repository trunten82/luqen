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
  salt?: string,
): Promise<void> {
  await server.register(secureSession, {
    secret: sessionSecret,
    salt: salt ?? 'luqen-dash-salt!',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
    },
    sessionName: 'session',
  });
}
