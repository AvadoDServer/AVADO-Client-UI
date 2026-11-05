/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  readonly VITE_MOCK_LIDO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
