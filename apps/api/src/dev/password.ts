/**
 * Checks or replaces a user's password, without either ever being stored.
 *
 *   pnpm --filter @omniplay/api password check you@example.com
 *   pnpm --filter @omniplay/api password set   you@example.com
 *
 * `check` answers the only question a hashed password allows: does this one
 * match? The hash is one-way, so nothing here can recover a forgotten
 * password - it can only replace it.
 *
 * The password is read from the terminal with echo off rather than taken as an
 * argument, so it never reaches shell history, a file, or a process list.
 */

import { createInterface } from 'node:readline';
import { prisma } from '@omniplay/database';
import { hashPassword, verifyPassword } from '../auth/password.js';

/** Reads one line with the terminal's echo suppressed. */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const rl = createInterface({ input, output: process.stdout, terminal: true });

    // `terminal: true` echoes by default; muting the output stream is what
    // keeps the password off the screen and out of a shoulder's view.
    let muted = false;
    const write = (rl as unknown as { output: { write: (chunk: string) => void } }).output.write.bind(
      (rl as unknown as { output: NodeJS.WriteStream }).output,
    );
    (rl as unknown as { output: { write: (chunk: string) => void } }).output.write = (
      chunk: string,
    ): void => {
      if (!muted) write(chunk);
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });

    muted = true;
  });
}

async function main(): Promise<void> {
  const action = process.argv[2];
  const email = process.argv[3];

  if ((action !== 'check' && action !== 'set') || !email) {
    console.error('Usage: pnpm --filter @omniplay/api password <check|set> <email>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, passwordHash: true },
  });

  if (!user) {
    // Worth naming plainly: sign-in deliberately says "wrong email or
    // password" for either case, so a missing account looks like a bad
    // password from the outside.
    const all = await prisma.user.findMany({ select: { email: true } });
    console.error(`No account with email ${email}.`);
    console.error(`Accounts that do exist: ${all.map((u) => u.email).join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }

  if (action === 'check') {
    // A null hash is its own explanation: the account exists but has no
    // password at all, so every sign-in attempt fails whatever is typed.
    if (!user.passwordHash) {
      console.log(
        `${user.email} has no password set, so no password can work.\n` +
          `Run the same command with "set" to give it one.`,
      );
      return;
    }

    const candidate = await prompt('Password to check (typing is hidden): ');
    const ok = await verifyPassword(candidate, user.passwordHash);

    console.log(
      ok
        ? `That password is correct for ${user.email}.`
        : `That password does NOT match ${user.email}.\n` +
          `Nothing can recover the original - run the same command with "set" to choose a new one.`,
    );
    return;
  }

  const first = await prompt('New password (typing is hidden): ');
  if (first.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const second = await prompt('Repeat it: ');
  if (first !== second) {
    console.error('The two entries did not match. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(first) },
  });

  // Existing sessions keep working otherwise, which is wrong after a password
  // change: whoever prompted the change should be the only one still signed in.
  const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`Password updated for ${user.email}. Signed out ${count} existing session(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
