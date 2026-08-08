// data-runtime — 外部 JSON 內容包載入、驗證、窄化 Reader、Resolver 註冊與通用 kernel。
// 對應 docs/00_core/architecture/13_data_runtime.md。唯一對外入口。

export * from './content-pack';
export * from './readers';
export * from './validation';
export * from './resolver-registry';
export * from './kernels';
