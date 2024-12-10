import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取外层的 package.json
const rootPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
// 读取 pkg 目录下的 package.json
const pkgPath = path.join(__dirname, '../pkg/package.json');
const pkgPkg = JSON.parse(fs.readFileSync(pkgPath));

// 合并需要的字段
pkgPkg.name = rootPkg.name;
pkgPkg.publishConfig = rootPkg.publishConfig;
pkgPkg.author = rootPkg.author;
pkgPkg.repository = rootPkg.repository;
pkgPkg.version = rootPkg.version;
pkgPkg.files = rootPkg.files;

// 写回文件
fs.writeFileSync(pkgPath, JSON.stringify(pkgPkg, null, 2));