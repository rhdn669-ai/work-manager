import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));
const BUILD_TIME = new Date().toISOString();

// 빌드 시 public/version.json 자동 생성 플러그인
function versionJsonPlugin() {
  return {
    name: 'version-json',
    buildStart() {
      writeFileSync(resolve('./public/version.json'), JSON.stringify({ version, buildTime: BUILD_TIME }, null, 2));
    },
  };
}

// 설정이 빠진 채로는 «운영본을 만들지 않는다».
//
// 2026-09-10 과 2026-09-11, 저장소를 그대로 가져다 빌드하는 자동 배포가 사내 서버 설정
// 없이 운영을 덮어썼다. 앱이 구글을 보게 되어 직원이 들어오지 못했다. 만들어진 뒤에
// 걸러 내려 했지만, 그 배포는 우리 검사를 거치지 않는 길로 올라간다.
// 그래서 «만드는 순간» 멈춘다 — 설정이 없으면 빌드가 실패하고, 실패한 것은 올라가지 못한다.
//
// 되돌리려면(구글로 돌아가야 할 때) 이 블록을 지운다.
function 운영설정확인(mode, env) {
  if (mode !== 'production') return;
  if (env.VITE_BACKEND === 'server' && env.VITE_SB_URL && env.VITE_SB_ANON_KEY) return;
  throw new Error(
    '사내 서버 설정이 없어 운영본을 만들 수 없습니다. .env.production 에 VITE_BACKEND=server · VITE_SB_URL · VITE_SB_ANON_KEY 가 있어야 합니다. 배포는 npm run deploy 로 하세요 — 그 안에서 설정을 갖춰 만듭니다.',
  );
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  운영설정확인(mode, loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __APP_BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
    plugins: [react(), versionJsonPlugin()],
    server: {
      host: true,
      allowedHosts: true, // 임시 공개 터널(trycloudflare/loca.lt 등) 호스트 허용 — dev 전용
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'firebase-vendor';
            }
            if (
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/react/')
            ) {
              return 'react-vendor';
            }
          },
        },
      },
    },
  };
});
