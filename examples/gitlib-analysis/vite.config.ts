/**
 * @description: vite配置
 * @return {*}
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { postcssLightningcssPlugin } from '@gogors/postcss-lightningcss-rs';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],

  css: {
    postcss: {
      plugins: [
        postcssLightningcssPlugin({
          minify: true,
          targets: ['IOS >= 8'],
        }),
      ],
    },
  },

  build: {
    target: 'es2015',
    rollupOptions: {
      output: {
        manualChunks: {
          // 提取 React 相关库
          'react-vendor': ['react', 'react-dom'],
          // 提取 Lodash
          'lodash-vendor': ['lodash'],
          // 提取 Ant Design 相关库
          'antd-vendor': ['antd'],
          // 提取 ECharts 相关库
          'echarts-vendor': ['echarts-for-react'],
        },
        // 用于分包的文件命名
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
      treeshake: {
        annotations: true, // 删掉@__PURE__、__NO_SIDE_EFFECTS__标记的函数或类的调用
        correctVarValueBeforeDeclaration: false, // 未被重新赋值的变量判定为常量，标记无副作用
        manualPureFunctions: [], // 手动标记为纯函数的函数名列表
        moduleSideEffects: (id) => {
          // html中使用<script type="module">引入的文件，不是一个明确的 ES Module 导入语句，无法静态分析，需要手动标记副作用
          if (id.includes('main.tsx')) {
            return true;
          }
          return false;
        },
        propertyReadSideEffects: false, // 判定未被使用的属性读取都无副作用
        unknownGlobalSideEffects: false, // 判定未被使用的全局变量都无副作用
        tryCatchDeoptimization: false, // 判定try-catch包裹的代码都无副作用(try...catch 语句中的代码无法被静态分析)
      }, // 启用 Tree Shaking
    },
    minify: true,
  },

  // 本地开发服务
  server: {
    host: 'local.neibu.koolearn.com', // host设置为true才可以使用network的形式，以ip访问项目
    // host: true,
    port: 5173, // 端口号
    // open: true, // 自动打开浏览器
    strictPort: true, // 如果端口已占用直接退出

  },
});
