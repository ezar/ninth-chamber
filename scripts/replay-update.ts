/**
 * Records the golden replays again (spec §16): runs the walkthrough tests with
 * REPLAY_UPDATE set, which saves each chamber's golden path to
 * tests/replays/<level>.replay.json.gz. Run it after an intended change to
 * the simulation or a level, and commit the new files.
 */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', '--testNamePattern', 'no deaths', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, REPLAY_UPDATE: '1' },
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
