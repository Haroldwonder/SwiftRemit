import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  upsertUser,
  verifyUserCredentials,
  getUserRole,
  resetUserStoreForTests,
} from './userStore';

describe('userStore (in-memory fallback, no DATABASE_URL configured)', () => {
  const originalAdmins = process.env.ADMIN_USER_IDS;
  const originalAgents = process.env.AGENT_USER_IDS;
  const originalStub = process.env.STUB_PASSWORD;

  beforeEach(() => {
    resetUserStoreForTests();
    delete process.env.ADMIN_USER_IDS;
    delete process.env.AGENT_USER_IDS;
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    delete process.env.AGENT_BOOTSTRAP_PASSWORD;
    delete process.env.STUB_PASSWORD;
  });

  afterEach(() => {
    resetUserStoreForTests();
    process.env.ADMIN_USER_IDS = originalAdmins;
    process.env.AGENT_USER_IDS = originalAgents;
    process.env.STUB_PASSWORD = originalStub;
  });

  it('rejects an unknown userId regardless of password', async () => {
    expect(await verifyUserCredentials('nobody', 'anything')).toBe(false);
  });

  it('a valid password for one identity does not authenticate a different one', async () => {
    await upsertUser('alice', 'alice-secret', 'user');
    await upsertUser('bob', 'bob-secret', 'user');

    expect(await verifyUserCredentials('alice', 'alice-secret')).toBe(true);
    // The old stub compared every login against one shared secret — this is
    // exactly the case that made that unsafe: a password that is valid for
    // "alice" must not authenticate as "bob".
    expect(await verifyUserCredentials('bob', 'alice-secret')).toBe(false);
    expect(await verifyUserCredentials('alice', 'bob-secret')).toBe(false);
  });

  it('rejects an incorrect password for a known user', async () => {
    await upsertUser('carol', 'correct-horse', 'user');
    expect(await verifyUserCredentials('carol', 'wrong-password')).toBe(false);
  });

  it('resolves role from the store, defaulting new users to "user"', async () => {
    await upsertUser('dave', 'dave-secret', 'agent');
    expect(await getUserRole('dave')).toBe('agent');
    expect(await getUserRole('never-created')).toBe('user');
  });

  it('seeds ADMIN_USER_IDS / AGENT_USER_IDS as bootstrap accounts on first use only', async () => {
    process.env.ADMIN_USER_IDS = 'root-admin';
    process.env.AGENT_USER_IDS = 'field-agent';
    process.env.STUB_PASSWORD = 'bootstrap-password';

    expect(await verifyUserCredentials('root-admin', 'bootstrap-password')).toBe(true);
    expect(await getUserRole('root-admin')).toBe('admin');
    expect(await getUserRole('field-agent')).toBe('agent');

    // Bootstrap seeding must not clobber a password that was changed after
    // the initial seed (e.g. via a real credential-management flow).
    await upsertUser('root-admin', 'rotated-password', 'admin');
    expect(await verifyUserCredentials('root-admin', 'bootstrap-password')).toBe(false);
    expect(await verifyUserCredentials('root-admin', 'rotated-password')).toBe(true);
  });
});
