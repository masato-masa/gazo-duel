// dist/ を gh-pages ブランチへ公開する。
// GitHub Actions を使わないのは、この環境の gh トークンに workflow スコープが無く
// .github/workflows/ を push できないため。CI から出したくなったら README を参照。
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE = '.gh-pages';
const BRANCH = 'gh-pages';

// git は実行ファイルを直接叩く。shell 経由にすると Windows で
// 引数中の空白が分割されてコミットメッセージが壊れる。
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

// npm は Windows では npm.cmd なので shell を通す必要がある
const runNpm = (args) =>
  execFileSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });

function cleanWorktree() {
  try {
    run('git', ['worktree', 'remove', '--force', WORKTREE], { stdio: 'ignore' });
  } catch {
    /* 無ければ何もしない */
  }
  rmSync(WORKTREE, { recursive: true, force: true });
}

console.log('ビルドします...');
runNpm(['run', 'build']);

console.log(`${BRANCH} ブランチを用意します...`);
cleanWorktree();

// リモートに gh-pages があればそれを引き継ぎ、無ければ履歴なしの新しいブランチを作る
let hasRemote = false;
try {
  hasRemote = capture('git', ['ls-remote', '--heads', 'origin', BRANCH]).length > 0;
} catch {
  hasRemote = false;
}

if (hasRemote) {
  run('git', ['fetch', 'origin', BRANCH]);
  run('git', ['worktree', 'add', '-B', BRANCH, WORKTREE, `origin/${BRANCH}`]);
} else {
  run('git', ['worktree', 'add', '--detach', WORKTREE]);
  run('git', ['-C', WORKTREE, 'checkout', '--orphan', BRANCH]);
  run('git', ['-C', WORKTREE, 'rm', '-rf', '--quiet', '.']);
}

// 前回の中身を消してから dist を置き直す（.git は残す）
for (const entry of readdirSync(WORKTREE)) {
  if (entry === '.git') continue;
  rmSync(join(WORKTREE, entry), { recursive: true, force: true });
}
mkdirSync(WORKTREE, { recursive: true });
cpSync('dist', WORKTREE, { recursive: true });
// アンダースコア始まりのファイルを Jekyll に無視されないようにする
writeFileSync(join(WORKTREE, '.nojekyll'), '');

run('git', ['-C', WORKTREE, 'add', '-A']);
const changed = capture('git', ['-C', WORKTREE, 'status', '--porcelain']).length > 0;
if (!changed) {
  console.log('変更なし。公開済みの内容と同じです。');
  cleanWorktree();
  process.exit(0);
}

const sha = capture('git', ['rev-parse', '--short', 'HEAD']);
run('git', ['-C', WORKTREE, 'commit', '-m', `deploy: ${sha}`]);
run('git', ['-C', WORKTREE, 'push', '-u', 'origin', BRANCH]);
cleanWorktree();
console.log('公開しました。');
