import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm } from 'fs/promises';

const execAsync = promisify(exec);

const TARGETS = [
  {
    target: 'web',
    outDir: 'pkg/web',
  },
  // {
  //   target: 'nodejs',
  //   outDir: 'pkg/node',
  // },
  {
    target: 'bundler',
    outDir: 'pkg/bundler',
  },
  {
    target: 'no-modules',
    outDir: 'pkg/no-modules',
  },
];

async function buildTarget({ target, outDir }) {
  console.log(`🚀 开始构建 target: ${target}...`);

  try {
    // 创建输出目录
    await mkdir(outDir, { recursive: true });

    // 执行wasm-pack构建
    const cmd = `wasm-pack build --out-dir ${outDir} --target ${target} --scope gogors`;
    const { stderr } = await execAsync(cmd);

    if (stderr.includes('error')) {
      console.error(`❌ ${target} 构建出错:`, stderr);
      throw new Error(stderr);
    }

    console.log(`✅ ${target} 构建成功!\n`);

    // 删除 .gitignore 文件
    await rm(`${outDir}/.gitignore`, { force: true });
  } catch (error) {
    console.error(`❌ ${target} 构建失败:`, error);
  }
}

async function build() {
  console.log('🔨 开始并发构建所有目标...\n');
  const startTime = Date.now();

  try {
    // 并发执行所有构建
    await Promise.all(TARGETS.map(buildTarget));

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n✨ 所有构建完成! 耗时: ${duration}s`);
  } catch (error) {
    console.error('💥 构建过程中出现错误:', error);
    process.exit(1);
  }
}

build();
