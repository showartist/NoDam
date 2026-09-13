/** @type {import('next').NextConfig} */
export default {
  // node:sqlite 는 Node 런타임 내장 모듈이라 번들링 대상에서 제외한다.
  serverExternalPackages: ["node:sqlite"],
};
