// ==========================================
// js/services/version.js
// 作用：App 版本与备份格式版本的唯一来源
// 注意：sw.js 是 classic script，无法 import，改版本时两处必须同步：
//   - js/services/version.js  (APP_VERSION)
//   - sw.js                   (APP_VERSION，同时升 CACHE_NAME)
// ==========================================

export const APP_VERSION = '0.1.13';

// 备份载荷的 schema 版本：字段增删 / 语义变化时才升，与 APP_VERSION 解耦
export const BACKUP_SCHEMA = 3;






